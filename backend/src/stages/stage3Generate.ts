import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { toolsFor } from "../config/config.js";
import type { AppContext } from "../context.js";
import { skillDir } from "../jobs/jobPaths.js";
import type { GeneratedSkill, SkillPlanItem, SkillValidation } from "../jobs/types.js";
import { applyResult, ceilingReached } from "../meter/costMeter.js";
import { emit, emitJob } from "../runtime/broadcast.js";

const DESC_MAX = 1536;
const BODY_MAX_LINES = 500;

export function generationPrompt(skill: SkillPlanItem, briefsText: string): string {
  return [
    `[[SKILLGEN]] SKILL_SLUG=${skill.slug}`,
    `Write a complete Claude Agent Skill directory in the CURRENT WORKING DIRECTORY for "${skill.name}".`,
    "",
    "Create these files (and ONLY under the current directory):",
    "- SKILL.md: YAML frontmatter with `name` and `description`, then a LEAN markdown body.",
    `  The description must be load-bearing and slightly 'pushy' (what it does + trigger contexts), under ${DESC_MAX} characters.`,
    `  Keep the body under ${BODY_MAX_LINES} lines; move heavy detail (API tables, config matrices) into references/*.md and link to them.`,
    "- references/*.md: the heavy researched detail (loaded on demand).",
    "- scripts/: ONLY if a deterministic helper genuinely beats prose; these are shipped as data, not run by Skill Smith.",
    "",
    `Scope boundaries: ${skill.scopeBoundaries}`,
    `Draft description to refine: ${skill.description}`,
    "",
    "Research to ground the skill in (do not invent APIs or versions):",
    briefsText || "(none)",
  ].join("\n");
}

/** Parse the leading YAML frontmatter block (between --- fences) without adding a dependency. */
function parseFrontmatter(md: string): { fm: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm, body: md };
  for (const line of (m[1] ?? "").split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return { fm, body: m[2] ?? "" };
}

/** Deterministic ground-truth validation of a generated skill directory (no LLM). */
export function validateSkill(dir: string): SkillValidation {
  const issues: string[] = [];
  const skillMd = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    return { ok: false, descriptionChars: 0, bodyLines: 0, hasReferences: false, issues: ["SKILL.md missing"] };
  }
  const md = fs.readFileSync(skillMd, "utf8");
  const { fm, body } = parseFrontmatter(md);
  if (!fm.name) issues.push("frontmatter missing name");
  if (!fm.description) issues.push("frontmatter missing description");
  const descriptionChars = (fm.description ?? "").length;
  if (descriptionChars > DESC_MAX) issues.push(`description too long (${descriptionChars} > ${DESC_MAX})`);
  const bodyLines = body.split("\n").filter((l) => l.trim().length > 0).length;
  if (bodyLines > BODY_MAX_LINES) issues.push(`body too long (${bodyLines} > ${BODY_MAX_LINES} non-blank lines)`);
  const hasReferences = fs.existsSync(path.join(dir, "references"));
  return { ok: issues.length === 0, descriptionChars, bodyLines, hasReferences, issues };
}

/** Stage 3 — generate each approved skill's directory, then validate it deterministically. */
export async function runStage3(ctx: AppContext, jobId: string): Promise<void> {
  const job = await ctx.jobStore.get(jobId);
  const plan = job?.design?.skills ?? [];
  if (plan.length === 0) return;

  // Brief text reused across skills for grounding.
  const { readBriefs } = await import("./stage2Design.js");
  const briefs = await readBriefs(ctx, jobId);
  const briefsText = briefs
    .map((b) => `### ${b.domain}\nAPIs: ${b.key_apis.join(", ")}\nGotchas: ${b.gotchas.join(", ")}\nVersions: ${b.version_notes}`)
    .join("\n\n");

  await ctx.jobStore.update(jobId, (j) => {
    j.generation = {
      status: "running",
      skills: plan.map<GeneratedSkill>((s) => ({ name: s.name, slug: s.slug, status: "pending" })),
    };
    const stage = j.stages.find((s) => s.key === "generate");
    if (stage) {
      stage.status = "running";
      stage.startedAt = new Date().toISOString();
    }
    j.status = "active";
  });
  await emit(ctx, jobId, "stage", { stageKey: "generate", status: "running" });
  for (const s of plan) await emit(ctx, jobId, "skill", { name: s.name, slug: s.slug, status: "pending" });

  const tools = toolsFor(ctx.config, "generate"); // Read/Write/Edit/Bash — NO web

  await Promise.allSettled(plan.map((skill) => generateOne(ctx, jobId, skill, briefsText, tools)));

  const finished = await ctx.jobStore.update(jobId, (j) => {
    const states = j.generation?.skills ?? [];
    const anyOk = states.some((s) => s.status === "done");
    const anyFail = states.some((s) => s.status === "failed");
    const status = !anyOk ? "failed" : anyFail ? "done_with_warnings" : "done";
    if (j.generation) j.generation.status = status;
    const stage = j.stages.find((s) => s.key === "generate");
    if (stage) {
      stage.status = status === "failed" ? "failed" : "done";
      stage.endedAt = new Date().toISOString();
      if (status === "done_with_warnings") stage.error = "some skills failed validation; partial output saved";
    }
    if (status === "failed") j.status = "failed";
  });

  await emit(ctx, jobId, "stage", {
    stageKey: "generate",
    status: finished.generation?.status === "failed" ? "failed" : "done",
  });
  await emitJob(ctx, finished);
}

async function generateOne(
  ctx: AppContext,
  jobId: string,
  skill: SkillPlanItem,
  briefsText: string,
  tools: string[],
): Promise<void> {
  const dir = skillDir(ctx.config.workspaceDir, jobId, skill.slug);

  const current = await ctx.jobStore.get(jobId);
  if (current && ceilingReached(current.meter)) {
    await markSkill(ctx, jobId, skill, "failed", "per-job invocation ceiling reached");
    return;
  }
  await markSkill(ctx, jobId, skill, "running");

  try {
    await fsp.mkdir(dir, { recursive: true });
    const res = await ctx.claude.stream({
      prompt: generationPrompt(skill, briefsText),
      tools,
      cwd: dir, // the model writes the skill directory in here
      onRaw: (chunk) => void ctx.jobStore.appendRaw(jobId, `gen-${skill.slug}`, chunk),
      onAttempt: (attempt, maxRetries, delayMs, reason) =>
        ctx.sse.broadcast(jobId, "retry", { skill: skill.slug, attempt, maxRetries, delayMs, reason }),
    });

    const validation = validateSkill(dir);
    const updated = await ctx.jobStore.update(jobId, (j) => {
      j.meter = applyResult(j.meter, res.info);
      j.meter.ceilingHit = ceilingReached(j.meter);
      const gs = j.generation?.skills.find((s) => s.slug === skill.slug);
      if (gs) {
        gs.status = validation.ok ? "done" : "failed";
        gs.validation = validation;
        if (!validation.ok) gs.error = validation.issues.join("; ");
      }
    });
    await emit(ctx, jobId, "meter", updated.meter);
    await emit(ctx, jobId, "skill", {
      name: skill.name,
      slug: skill.slug,
      status: validation.ok ? "done" : "failed",
      validation,
    });
  } catch (err) {
    await markSkill(ctx, jobId, skill, "failed", err instanceof Error ? err.message : String(err));
  }
}

async function markSkill(
  ctx: AppContext,
  jobId: string,
  skill: SkillPlanItem,
  status: GeneratedSkill["status"],
  error?: string,
): Promise<void> {
  await ctx.jobStore.update(jobId, (j) => {
    const gs = j.generation?.skills.find((s) => s.slug === skill.slug);
    if (gs) {
      gs.status = status;
      if (error) gs.error = error;
    }
  });
  await emit(ctx, jobId, "skill", { name: skill.name, slug: skill.slug, status, ...(error ? { error } : {}) });
}
