import type { AppContext } from "../context.js";
import { applyResult, ceilingReached } from "../meter/costMeter.js";
import { emit, emitJob } from "./broadcast.js";

/**
 * The end-to-end round-trip proof: spawn `claude -p "say hi"`, stream the output
 * live over SSE, and record cost/usage in the job meter. Runs in the background;
 * progress and the final state are recoverable entirely from disk.
 */
export async function runSayHi(ctx: AppContext, jobId: string): Promise<void> {
  const callId = "sayhi";
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
      await failJob(ctx, jobId, "Per-job invocation ceiling reached before start");
      return;
    }

    const result = await ctx.claude.stream({
      prompt: "say hi",
      tools: ctx.config.toolPermissions.scope,
      cwd: ctx.jobStore.dir(jobId),
      onText: (text) => {
        ctx.sse.broadcast(jobId, "log", { stageKey: "scope", text });
      },
      onRaw: (chunk) => {
        void ctx.jobStore.appendRaw(jobId, callId, chunk);
      },
      onAttempt: (attempt, maxRetries, delayMs, reason) => {
        ctx.sse.broadcast(jobId, "retry", { attempt, maxRetries, delayMs, reason });
      },
    });

    job = await ctx.jobStore.update(jobId, (j) => {
      j.meter = applyResult(j.meter, result.info);
      j.meter.ceilingHit = ceilingReached(j.meter);
      const stage = j.stages.find((s) => s.key === "scope");
      if (stage) {
        stage.status = "done";
        stage.endedAt = new Date().toISOString();
      }
      j.status = "done";
    });
    await emit(ctx, jobId, "meter", job.meter);
    await emitJob(ctx, job);
    await emit(ctx, jobId, "done", { stageKey: "scope" });
  } catch (err) {
    await failJob(ctx, jobId, err instanceof Error ? err.message : String(err));
  }
}

async function failJob(ctx: AppContext, jobId: string, message: string): Promise<void> {
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
