import { z } from "zod";
import type { AppContext } from "../context.js";
import { applyResult, ceilingReached } from "../meter/costMeter.js";
import { emit, emitJob } from "../runtime/broadcast.js";
import type { Scope, ScopeQuestion } from "../jobs/types.js";

/** JSON schema handed to `claude -p --json-schema` so Stage 0 returns typed fields. */
export const SCOPE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    targetStack: { type: "string" },
    domains: { type: "array", items: { type: "string" } },
    likelyTasks: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          type: { type: "string", enum: ["single", "multi", "text"] },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["id", "question", "type"],
      },
    },
  },
  required: ["targetStack", "domains", "likelyTasks", "questions"],
} as const;

const ScopeResultSchema = z.object({
  targetStack: z.string(),
  domains: z.array(z.string()),
  likelyTasks: z.array(z.string()),
  questions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        type: z.enum(["single", "multi", "text"]),
        options: z.array(z.string()).optional(),
      }),
    )
    .max(5),
});

function scopePrompt(description: string): string {
  return [
    "You are the intake/scoping step of a tool that generates Claude Agent Skills for a stack.",
    "Given a one-line project description, decompose it for downstream research.",
    "Return ONLY the structured fields requested:",
    "- targetStack: the concrete stack in one phrase.",
    "- domains: the distinct knowledge domains a coding agent would need (split by variant).",
    "- likelyTasks: representative tasks an agent would perform in this stack.",
    "- questions: up to 5 SHORT clarifying questions whose answers materially change the skills.",
    "  Prefer single/multi-select with concrete options; use text only when necessary.",
    "",
    `Project description: ${description}`,
  ].join("\n");
}

/** Run the Stage-0 scoping claude call and park the job awaiting the user's answers. */
export async function runStage0(ctx: AppContext, jobId: string): Promise<void> {
  const callId = "stage0-scope";
  try {
    let job = await ctx.jobStore.update(jobId, (j) => {
      const stage = j.stages.find((s) => s.key === "scope");
      if (stage) {
        stage.status = "running";
        stage.startedAt = new Date().toISOString();
      }
    });
    await emit(ctx, jobId, "stage", { stageKey: "scope", status: "running" });

    if (ceilingReached(job.meter)) {
      await failScope(ctx, jobId, "Per-job invocation ceiling reached before start");
      return;
    }

    const res = await ctx.claude.structured({
      prompt: scopePrompt(job.description),
      jsonSchema: SCOPE_JSON_SCHEMA,
      tools: ctx.config.toolPermissions.scope, // empty — no web in scoping
      cwd: ctx.jobStore.dir(jobId),
      onRaw: (chunk) => void ctx.jobStore.appendRaw(jobId, callId, chunk),
      onAttempt: (attempt, maxRetries, delayMs, reason) =>
        ctx.sse.broadcast(jobId, "retry", { attempt, maxRetries, delayMs, reason }),
    });

    const parsed = ScopeResultSchema.parse(res.structuredOutput);
    const questions: ScopeQuestion[] = parsed.questions;

    job = await ctx.jobStore.update(jobId, (j) => {
      j.meter = applyResult(j.meter, res.info);
      j.meter.ceilingHit = ceilingReached(j.meter);
      j.scope = {
        targetStack: parsed.targetStack,
        domains: parsed.domains,
        likelyTasks: parsed.likelyTasks,
        questions,
      };
      j.questions = questions;
      const stage = j.stages.find((s) => s.key === "scope");
      if (stage) stage.status = "awaiting_input";
      j.status = "awaiting_input";
    });

    await emit(ctx, jobId, "meter", job.meter);
    await emit(ctx, jobId, "question", { questions });
    await emit(ctx, jobId, "stage", { stageKey: "scope", status: "awaiting_input" });
    await emitJob(ctx, job);
  } catch (err) {
    await failScope(ctx, jobId, err instanceof Error ? err.message : String(err));
  }
}

export interface AnswerInput {
  answers?: Record<string, string | string[]>;
  useDefaults?: boolean;
}

function defaultAnswer(q: ScopeQuestion): string | string[] {
  if (q.type === "text") return "";
  const first = q.options?.[0] ?? "";
  return q.type === "multi" ? (first ? [first] : []) : first;
}

/**
 * Apply the user's answers (or defaults), persist scope.json, and mark Stage 0
 * done. The pipeline intentionally does NOT advance past Stage 0 in this phase.
 */
export async function applyAnswers(ctx: AppContext, jobId: string, input: AnswerInput): Promise<Scope> {
  const current = await ctx.jobStore.get(jobId);
  if (!current) throw new Error(`Job not found: ${jobId}`);
  if (!current.scope) throw new Error("Scope not ready: Stage 0 has not produced questions yet");

  const questions = current.scope.questions;
  const answers: Record<string, string | string[]> = {};
  for (const q of questions) {
    if (input.useDefaults) {
      answers[q.id] = defaultAnswer(q);
    } else {
      answers[q.id] = input.answers?.[q.id] ?? defaultAnswer(q);
    }
  }

  const scope: Scope = { ...current.scope, answers, usedDefaults: !!input.useDefaults };
  await ctx.jobStore.writeScope(jobId, scope);

  const job = await ctx.jobStore.update(jobId, (j) => {
    j.scope = scope;
    j.answers = answers;
    const stage = j.stages.find((s) => s.key === "scope");
    if (stage) {
      stage.status = "done";
      stage.endedAt = new Date().toISOString();
    }
    // Stages 1-5 remain pending this phase; the job is no longer awaiting input.
    j.status = "active";
  });

  await emit(ctx, jobId, "stage", { stageKey: "scope", status: "done" });
  await emitJob(ctx, job);
  return scope;
}

async function failScope(ctx: AppContext, jobId: string, message: string): Promise<void> {
  const job = await ctx.jobStore
    .update(jobId, (j) => {
      const stage = j.stages.find((s) => s.key === "scope");
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
