import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { toolsFor } from "../config/config.js";
import type { AppContext } from "../context.js";
import { slug } from "../jobs/jobPaths.js";
import type { ResearchBrief, SkillPlanItem } from "../jobs/types.js";
import { applyResult, ceilingReached } from "../meter/costMeter.js";
import { emit, emitJob } from "../runtime/broadcast.js";
import { runStage3 } from "./stage3Generate.js";

/** Cap the number of skills a single job will generate (cost guardrail). */
const MAX_SKILLS = 12;
const DESC_MAX = 1536;

/** JSON schema for the Stage-2 skill-set plan. */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    skills: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          scopeBoundaries: { type: "string" },
          sourceDomains: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "scopeBoundaries", "sourceDomains"],
      },
    },
  },
  required: ["skills"],
} as const;

const PlanSchema = z.object({
  skills: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        scopeBoundaries: z.string(),
        sourceDomains: z.array(z.string()),
      }),
    )
    .min(1),
});

export function designPrompt(targetStack: string, briefs: ResearchBrief[]): string {
  const briefText = briefs
    .map(
      (b) =>
        `### ${b.domain}\nAPIs: ${b.key_apis.join(", ")}\nIdioms: ${b.idioms.join(", ")}\nGotchas: ${b.gotchas.join(", ")}\nVersions: ${b.version_notes}`,
    )
    .join("\n\n");
  return [
    `You are designing a SET of Claude Agent Skills for the stack: ${targetStack}.`,
    "Propose a small family of focused skills following these rules:",
    "- ONE domain per skill; split by variant (e.g. springboot-rest, springboot-soap, springboot-persistence-jpa) rather than one mega-skill.",
    "- Each name is short kebab-case.",
    "- Each description is LOAD-BEARING and slightly 'pushy': say what the skill does AND the specific contexts/phrases that should trigger it. Keep it well under 1536 characters.",
    "- scopeBoundaries: one line on what this skill covers and explicitly does NOT.",
    "- sourceDomains: which research domains feed this skill.",
    "",
    "Research briefs to base the plan on:",
    briefText || "(no briefs available)",
    "",
    "Return ONLY the structured plan.",
  ].join("\n");
}

/** Load every Stage-1 research brief from disk for a job. */
export async function readBriefs(ctx: AppContext, jobId: string): Promise<ResearchBrief[]> {
  const dir = path.join(ctx.jobStore.dir(jobId), "research");
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const briefs: ResearchBrief[] = [];
  for (const e of entries) {
    if (!e.endsWith(".json")) continue;
    try {
      briefs.push(JSON.parse(await fsp.readFile(path.join(dir, e), "utf8")));
    } catch {
      /* skip unreadable brief */
    }
  }
  return briefs;
}

function toPlanItems(raw: z.infer<typeof PlanSchema>): SkillPlanItem[] {
  const seen = new Set<string>();
  const items: SkillPlanItem[] = [];
  for (const s of raw.skills) {
    const sl = slug(s.name);
    if (seen.has(sl)) continue; // dedupe by slug
    seen.add(sl);
    items.push({
      name: s.name,
      slug: sl,
      description: s.description.slice(0, DESC_MAX),
      scopeBoundaries: s.scopeBoundaries,
      sourceDomains: s.sourceDomains,
    });
    if (items.length >= MAX_SKILLS) break;
  }
  return items;
}

/** Stage 2 — propose a skill-set plan from the research briefs, then PARK for approval. */
export async function runStage2(ctx: AppContext, jobId: string): Promise<void> {
  try {
    let job = await ctx.jobStore.update(jobId, (j) => {
      j.design = { status: "running", skills: [] };
      const stage = j.stages.find((s) => s.key === "design");
      if (stage) {
        stage.status = "running";
        stage.startedAt = new Date().toISOString();
      }
    });
    await emit(ctx, jobId, "stage", { stageKey: "design", status: "running" });

    if (ceilingReached(job.meter)) {
      await failDesign(ctx, jobId, "Per-job invocation ceiling reached before start");
      return;
    }

    const briefs = await readBriefs(ctx, jobId);
    const targetStack = job.scope?.targetStack ?? job.description;
    const res = await ctx.claude.structured({
      prompt: designPrompt(targetStack, briefs),
      jsonSchema: PLAN_JSON_SCHEMA,
      tools: toolsFor(ctx.config, "design"), // [] — no tools needed to design
      cwd: ctx.jobStore.dir(jobId),
      onRaw: (chunk) => void ctx.jobStore.appendRaw(jobId, "design", chunk),
      onAttempt: (attempt, maxRetries, delayMs, reason) =>
        ctx.sse.broadcast(jobId, "retry", { attempt, maxRetries, delayMs, reason }),
    });

    const skills = toPlanItems(PlanSchema.parse(res.structuredOutput));

    job = await ctx.jobStore.update(jobId, (j) => {
      j.meter = applyResult(j.meter, res.info);
      j.meter.ceilingHit = ceilingReached(j.meter);
      j.design = { status: "awaiting_approval", skills };
      const stage = j.stages.find((s) => s.key === "design");
      if (stage) stage.status = "awaiting_input";
      j.status = "awaiting_input";
    });

    await emit(ctx, jobId, "meter", job.meter);
    await emit(ctx, jobId, "design", { status: "awaiting_approval", skills });
    await emit(ctx, jobId, "stage", { stageKey: "design", status: "awaiting_input" });
    await emitJob(ctx, job);
  } catch (err) {
    await failDesign(ctx, jobId, err instanceof Error ? err.message : String(err));
  }
}

export interface PlanInput {
  approve?: boolean;
  skills?: Array<{ name: string; description: string; scopeBoundaries: string; sourceDomains: string[] }>;
}

/** Apply the user's plan approval/edit, persist plan.json, mark design done, and kick generation. */
export async function applyPlan(ctx: AppContext, jobId: string, input: PlanInput): Promise<SkillPlanItem[]> {
  const job = await ctx.jobStore.get(jobId);
  if (!job?.design) throw new Error("No skill plan to approve yet");

  const skills = input.skills
    ? toPlanItems(PlanSchema.parse({ skills: input.skills }))
    : job.design.skills;
  if (skills.length === 0) throw new Error("Approved plan has no skills");

  await ctx.jobStore.writePlan(jobId, skills);
  const updated = await ctx.jobStore.update(jobId, (j) => {
    j.design = { status: "done", skills };
    const stage = j.stages.find((s) => s.key === "design");
    if (stage) {
      stage.status = "done";
      stage.endedAt = new Date().toISOString();
    }
    j.status = "active";
  });

  await emit(ctx, jobId, "design", { status: "done", skills });
  await emit(ctx, jobId, "stage", { stageKey: "design", status: "done" });
  await emitJob(ctx, updated);

  void runStage3(ctx, jobId);
  return skills;
}

async function failDesign(ctx: AppContext, jobId: string, message: string): Promise<void> {
  const job = await ctx.jobStore
    .update(jobId, (j) => {
      if (j.design) j.design.status = "failed";
      const stage = j.stages.find((s) => s.key === "design");
      if (stage) {
        stage.status = "failed";
        stage.error = message;
        stage.endedAt = new Date().toISOString();
      }
      j.status = "failed";
    })
    .catch(() => null);
  await emit(ctx, jobId, "error", { message });
  if (job) await emitJob(ctx, job);
}
