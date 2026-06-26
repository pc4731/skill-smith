import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { toolsFor } from "../config/config.js";
import type { AppContext } from "../context.js";
import { skillDir } from "../jobs/jobPaths.js";
import type { SelfTestSkill, SkillPlanItem, SkillReport } from "../jobs/types.js";
import { applyResult, ceilingReached } from "../meter/costMeter.js";
import { emit, emitJob } from "../runtime/broadcast.js";
import { generateOne } from "./stage3Generate.js";

// ---- structured-output schemas ----
export const TRIGGER_PROMPTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    shouldTrigger: { type: "array", items: { type: "string" }, minItems: 3 },
    shouldNot: { type: "array", items: { type: "string" }, minItems: 1 },
  },
  required: ["shouldTrigger", "shouldNot"],
} as const;

export const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { skill: { type: "string" } },
  required: ["skill"],
} as const;

export const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    passed: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["score", "passed", "issues"],
} as const;

export const DESC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { description: { type: "string" } },
  required: ["description"],
} as const;

const TriggerPromptsSchema = z.object({ shouldTrigger: z.array(z.string()).min(1), shouldNot: z.array(z.string()).min(1) });
const JudgeSchema = z.object({ skill: z.string() });
const GradeSchema = z.object({ score: z.number(), passed: z.boolean(), issues: z.array(z.string()) });
const DescSchema = z.object({ description: z.string() });

const DESC_MAX = 1536;

interface SkillContext {
  skill: SkillPlanItem;
  description: string; // current (possibly rewritten) description
}

/**
 * Stage 4 — the differentiator. For each generated skill: (a) measure TRIGGER
 * reliability (does a judge load it from name+description alone?), rewriting the
 * description until it clears the threshold; (b) CAPABILITY grade a representative
 * task against brief-derived assertions. Save report.json; iterate-on-failure back
 * to generation, capped. All bounded by the per-job ceiling / parallelism semaphore.
 */
export async function runStage4(ctx: AppContext, jobId: string): Promise<void> {
  const job = await ctx.jobStore.get(jobId);
  const generated = job?.generation?.skills.filter((s) => s.status === "done") ?? [];
  const plan = job?.design?.skills ?? [];
  if (generated.length === 0) return;

  const targets = generated
    .map((g) => plan.find((p) => p.slug === g.slug))
    .filter((p): p is SkillPlanItem => !!p);

  await ctx.jobStore.update(jobId, (j) => {
    j.selftest = { status: "running", skills: targets.map<SelfTestSkill>((p) => ({ name: p.name, slug: p.slug, status: "pending" })) };
    const stage = j.stages.find((s) => s.key === "test");
    if (stage) {
      stage.status = "running";
      stage.startedAt = new Date().toISOString();
    }
    j.status = "active";
  });
  await emit(ctx, jobId, "stage", { stageKey: "test", status: "running" });
  for (const p of targets) await emit(ctx, jobId, "report", { name: p.name, slug: p.slug, status: "pending" });

  await Promise.allSettled(targets.map((skill) => selfTestOne(ctx, jobId, skill)));

  const finished = await ctx.jobStore.update(jobId, (j) => {
    const states = j.selftest?.skills ?? [];
    const anyOk = states.some((s) => s.status === "done");
    const anyFail = states.some((s) => s.status === "failed");
    const status = !anyOk ? "failed" : anyFail ? "done_with_warnings" : "done";
    if (j.selftest) j.selftest.status = status;
    const stage = j.stages.find((s) => s.key === "test");
    if (stage) {
      stage.status = status === "failed" ? "failed" : "done";
      stage.endedAt = new Date().toISOString();
      if (status === "done_with_warnings") stage.error = "some skills failed self-test; reports saved";
    }
    if (status === "failed") j.status = "failed";
  });

  await emit(ctx, jobId, "stage", { stageKey: "test", status: finished.selftest?.status === "failed" ? "failed" : "done" });
  await emitJob(ctx, finished);

  // Advance into Stage 5 packaging (unless self-test wholly failed).
  if (finished.selftest?.status !== "failed") {
    const { runStage5 } = await import("./stage5Package.js");
    void runStage5(ctx, jobId);
  }
}

/**
 * Resume Stage 4 — incremental self-test. Unlike `runStage4` which resets all
 * skills, this only re-tests skills that do NOT already have a PASSING report on
 * disk (skills/<slug>/report.json). Skills that already passed keep their metrics
 * and replay zero tokens. Mirrors `resumeStage1` at skill granularity.
 */
export async function resumeStage4(ctx: AppContext, jobId: string): Promise<void> {
  const job = await ctx.jobStore.get(jobId);
  const generated = job?.generation?.skills.filter((s) => s.status === "done") ?? [];
  const plan = job?.design?.skills ?? [];
  if (generated.length === 0) return;

  const targets = generated
    .map((g) => plan.find((p) => p.slug === g.slug))
    .filter((p): p is SkillPlanItem => !!p);

  // Partition targets into skills with a passing report on disk vs. pending.
  const pending: SkillPlanItem[] = [];
  const merged: SelfTestSkill[] = [];
  for (const p of targets) {
    const report = await ctx.jobStore.readReport(jobId, p.slug);
    if (report?.passed) {
      merged.push({
        name: p.name,
        slug: p.slug,
        status: "done",
        triggerRate: report.triggerRate,
        falseTriggerRate: report.falseTriggerRate,
        capabilityScore: report.capabilityScore,
        passed: true,
        iterations: report.iterations,
      });
    } else {
      pending.push(p);
      merged.push({ name: p.name, slug: p.slug, status: "pending" });
    }
  }

  // Everything already passed → just advance to Stage 5.
  if (pending.length === 0) {
    const advanced = await ctx.jobStore.update(jobId, (j) => {
      j.selftest = { status: "done", skills: merged };
      const stage = j.stages.find((s) => s.key === "test");
      if (stage) {
        stage.status = "done";
        stage.endedAt = new Date().toISOString();
        stage.error = undefined;
      }
      j.status = "active";
    });
    await emit(ctx, jobId, "stage", { stageKey: "test", status: "done" });
    await emitJob(ctx, advanced);
    const { runStage5 } = await import("./stage5Package.js");
    void runStage5(ctx, jobId);
    return;
  }

  await ctx.jobStore.update(jobId, (j) => {
    j.selftest = { status: "running", skills: merged };
    const stage = j.stages.find((s) => s.key === "test");
    if (stage) {
      stage.status = "running";
      stage.startedAt = stage.startedAt ?? new Date().toISOString();
      stage.error = undefined;
    }
    j.status = "active";
  });
  await emit(ctx, jobId, "stage", { stageKey: "test", status: "running" });
  for (const m of merged) await emit(ctx, jobId, "report", { name: m.name, slug: m.slug, status: m.status });

  // Only (re-)test the skills that need it.
  await Promise.allSettled(pending.map((skill) => selfTestOne(ctx, jobId, skill)));

  const finished = await ctx.jobStore.update(jobId, (j) => {
    const states = j.selftest?.skills ?? [];
    const anyOk = states.some((s) => s.status === "done");
    const anyFail = states.some((s) => s.status === "failed");
    const status = !anyOk ? "failed" : anyFail ? "done_with_warnings" : "done";
    if (j.selftest) j.selftest.status = status;
    const stage = j.stages.find((s) => s.key === "test");
    if (stage) {
      stage.status = status === "failed" ? "failed" : "done";
      stage.endedAt = new Date().toISOString();
      if (status === "done_with_warnings") stage.error = "some skills failed self-test; reports saved";
    }
    if (status === "failed") j.status = "failed";
  });

  await emit(ctx, jobId, "stage", { stageKey: "test", status: finished.selftest?.status === "failed" ? "failed" : "done" });
  await emitJob(ctx, finished);

  if (finished.selftest?.status !== "failed") {
    const { runStage5 } = await import("./stage5Package.js");
    void runStage5(ctx, jobId);
  }
}

async function selfTestOne(ctx: AppContext, jobId: string, skill: SkillPlanItem): Promise<void> {
  const cfg = ctx.config.selfTest;
  const ctxSkill: SkillContext = { skill, description: skill.description };

  const cur = await ctx.jobStore.get(jobId);
  if (cur && ceilingReached(cur.meter)) {
    await markSkill(ctx, jobId, skill, "failed", undefined, "per-job invocation ceiling reached");
    return;
  }
  await markSkill(ctx, jobId, skill, "running");

  try {
    const prompts = await genPrompts(ctx, jobId, ctxSkill);
    let iterations = 0;
    let triggerRate = 0;
    let falseTriggerRate = 0;
    let capabilityScore = 0;
    let passed = false;
    let issues: string[] = [];

    // outer loop bounded by maxIterations (shared across rewrite + regenerate)
    while (true) {
      ({ triggerRate, falseTriggerRate } = await measureTrigger(ctx, jobId, ctxSkill, prompts));

      while (triggerRate < cfg.triggerThreshold && iterations < cfg.maxIterations) {
        ctxSkill.description = await rewriteDescription(ctx, jobId, ctxSkill);
        await persistDescription(ctx, jobId, skill.slug, ctxSkill.description);
        iterations += 1;
        ({ triggerRate, falseTriggerRate } = await measureTrigger(ctx, jobId, ctxSkill, prompts));
      }

      const grade = await capabilityGrade(ctx, jobId, ctxSkill);
      capabilityScore = grade.score;
      issues = grade.issues;
      passed = triggerRate >= cfg.triggerThreshold && grade.passed;
      if (passed || iterations >= cfg.maxIterations) break;

      // iterate-on-failure: re-generate the skill with the grader feedback, then re-test
      iterations += 1;
      const briefsText = `Reviewer feedback from self-test: ${issues.join("; ")}`;
      await generateOne(ctx, jobId, skill, briefsText, toolsFor(ctx.config, "generate"));
    }

    const report: SkillReport = {
      slug: skill.slug,
      triggerRate: round2(triggerRate),
      falseTriggerRate: round2(falseTriggerRate),
      capabilityScore: round2(capabilityScore),
      passed,
      iterations,
      issues,
      prompts,
    };
    await ctx.jobStore.writeReport(jobId, skill.slug, report);

    const updated = await ctx.jobStore.update(jobId, (j) => {
      const st = j.selftest?.skills.find((s) => s.slug === skill.slug);
      if (st) {
        st.status = passed ? "done" : "failed";
        st.triggerRate = report.triggerRate;
        st.falseTriggerRate = report.falseTriggerRate;
        st.capabilityScore = report.capabilityScore;
        st.passed = passed;
        st.iterations = iterations;
      }
    });
    await emit(ctx, jobId, "report", {
      name: skill.name,
      slug: skill.slug,
      status: passed ? "done" : "failed",
      triggerRate: report.triggerRate,
      capabilityScore: report.capabilityScore,
      passed,
    });
    await emitJob(ctx, updated);
  } catch (err) {
    await markSkill(ctx, jobId, skill, "failed", undefined, err instanceof Error ? err.message : String(err));
  }
}

async function genPrompts(ctx: AppContext, jobId: string, s: SkillContext) {
  const res = await ctx.claude.structured({
    prompt: [
      `Generate test prompts for a Claude Agent Skill named "${s.skill.name}".`,
      `Description: ${s.description}`,
      `Scope: ${s.skill.scopeBoundaries}`,
      "Return shouldTrigger (4-6 realistic user prompts that SHOULD load this skill) and shouldNot (1-2 that should NOT).",
    ].join("\n"),
    jsonSchema: TRIGGER_PROMPTS_SCHEMA,
    tools: [],
    cwd: ctx.jobStore.dir(jobId),
    onRaw: (c) => void ctx.jobStore.appendRaw(jobId, `st-prompts-${s.skill.slug}`, c),
  });
  await meter(ctx, jobId, res.info);
  return TriggerPromptsSchema.parse(res.structuredOutput);
}

async function measureTrigger(
  ctx: AppContext,
  jobId: string,
  s: SkillContext,
  prompts: { shouldTrigger: string[]; shouldNot: string[] },
): Promise<{ triggerRate: number; falseTriggerRate: number }> {
  const trials = ctx.config.selfTest.trials;
  let hits = 0;
  let total = 0;
  for (const p of prompts.shouldTrigger) {
    for (let t = 0; t < trials; t++) {
      total += 1;
      if ((await judge(ctx, jobId, s, p, s.skill.slug)) === s.skill.slug) hits += 1;
    }
  }
  let falseHits = 0;
  let falseTotal = 0;
  for (const p of prompts.shouldNot) {
    for (let t = 0; t < trials; t++) {
      falseTotal += 1;
      if ((await judge(ctx, jobId, s, p, "none")) === s.skill.slug) falseHits += 1;
    }
  }
  return {
    triggerRate: total ? hits / total : 0,
    falseTriggerRate: falseTotal ? falseHits / falseTotal : 0,
  };
}

async function judge(ctx: AppContext, jobId: string, s: SkillContext, userPrompt: string, expect: string): Promise<string> {
  const lines = [
    "Given these skills (name + description only), which ONE would you load for the user prompt? Answer with its slug or 'none'.",
    `- ${s.skill.slug}: ${s.description}`,
    `User prompt: ${userPrompt}`,
  ];
  // The expected answer is NEVER shown to a real judge (it would invalidate the measurement).
  // It is only appended in test/eval mode so the mock CLI is deterministic.
  if (ctx.config.selfTest.evalLabel) lines.push(`EVAL_EXPECT=${expect}`);
  const res = await ctx.claude.structured({
    prompt: lines.join("\n"),
    jsonSchema: JUDGE_SCHEMA,
    tools: [],
    cwd: ctx.jobStore.dir(jobId),
    onRaw: (c) => void ctx.jobStore.appendRaw(jobId, `st-judge-${s.skill.slug}`, c),
  });
  await meter(ctx, jobId, res.info);
  return JudgeSchema.parse(res.structuredOutput).skill;
}

async function rewriteDescription(ctx: AppContext, jobId: string, s: SkillContext): Promise<string> {
  const res = await ctx.claude.structured({
    prompt: [
      `Rewrite this skill description to be more 'pushy' so it triggers reliably. DESC_SLUG=${s.skill.slug}`,
      `Current: ${s.description}`,
      `Keep it under ${DESC_MAX} characters; state what it does AND specific trigger contexts.`,
    ].join("\n"),
    jsonSchema: DESC_SCHEMA,
    tools: [],
    cwd: ctx.jobStore.dir(jobId),
    onRaw: (c) => void ctx.jobStore.appendRaw(jobId, `st-desc-${s.skill.slug}`, c),
  });
  await meter(ctx, jobId, res.info);
  return DescSchema.parse(res.structuredOutput).description.slice(0, DESC_MAX);
}

async function capabilityGrade(ctx: AppContext, jobId: string, s: SkillContext): Promise<{ score: number; passed: boolean; issues: string[] }> {
  // Run a representative task with the skill loaded (inlined; there is no headless --skill flag).
  const dir = skillDir(ctx.config.workspaceDir, jobId, s.skill.slug);
  const skillBody = readSkillBody(dir);
  const task = await ctx.claude.stream({
    prompt: [
      "[[CAPABILITY]]",
      `You have the following skill loaded:\n${skillBody}`,
      `Perform a representative task for: ${s.skill.name} (${s.skill.scopeBoundaries}). SKILL_SLUG=${s.skill.slug}`,
    ].join("\n"),
    tools: toolsFor(ctx.config, "test"),
    cwd: dir,
    onRaw: (c) => void ctx.jobStore.appendRaw(jobId, `st-cap-${s.skill.slug}`, c),
  });
  await meter(ctx, jobId, task.info);

  const grade = await ctx.claude.structured({
    prompt: [
      `Grade this output for the "${s.skill.name}" skill against the assertions (correct APIs, right versions, pitfalls avoided). SKILL_SLUG=${s.skill.slug}`,
      `Output:\n${task.text}`,
      "Return score 0..1, passed, and any issues.",
    ].join("\n"),
    jsonSchema: GRADE_SCHEMA,
    tools: [],
    cwd: ctx.jobStore.dir(jobId),
    onRaw: (c) => void ctx.jobStore.appendRaw(jobId, `st-grade-${s.skill.slug}`, c),
  });
  await meter(ctx, jobId, grade.info);
  return GradeSchema.parse(grade.structuredOutput);
}

function readSkillBody(dir: string): string {
  try {
    return fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return "";
  }
}

/** Replace the `description:` line in the SKILL.md frontmatter block. */
async function persistDescription(ctx: AppContext, jobId: string, slug: string, description: string): Promise<void> {
  const dir = skillDir(ctx.config.workspaceDir, jobId, slug);
  const file = path.join(dir, "SKILL.md");
  try {
    const md = await fsp.readFile(file, "utf8");
    const updated = md.replace(/^(description:).*$/m, `description: ${description.replace(/\n/g, " ")}`);
    await fsp.writeFile(file, updated, "utf8");
  } catch {
    /* skill file missing — leave as-is */
  }
  await ctx.jobStore.update(jobId, (j) => {
    const ps = j.design?.skills.find((p) => p.slug === slug);
    if (ps) ps.description = description;
  });
  const fresh = await ctx.jobStore.get(jobId);
  if (fresh?.design?.skills) await ctx.jobStore.writePlan(jobId, fresh.design.skills);
}

async function meter(ctx: AppContext, jobId: string, info: { totalCostUsd: number; inputTokens: number; outputTokens: number }) {
  const updated = await ctx.jobStore.update(jobId, (j) => {
    j.meter = applyResult(j.meter, info);
    j.meter.ceilingHit = ceilingReached(j.meter);
  });
  await emit(ctx, jobId, "meter", updated.meter);
}

async function markSkill(
  ctx: AppContext,
  jobId: string,
  skill: SkillPlanItem,
  status: SelfTestSkill["status"],
  _validation?: unknown,
  error?: string,
): Promise<void> {
  await ctx.jobStore.update(jobId, (j) => {
    const st = j.selftest?.skills.find((s) => s.slug === skill.slug);
    if (st) {
      st.status = status;
      if (error) st.error = error;
    }
  });
  await emit(ctx, jobId, "report", { name: skill.name, slug: skill.slug, status, ...(error ? { error } : {}) });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
