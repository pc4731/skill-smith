import type { AppContext } from "../context.js";
import type { Job } from "../jobs/types.js";

/**
 * Broadcast helpers that ALSO persist to events.ndjson, so the SSE buffer and
 * the on-disk log stay in step and a refresh/restart can rebuild state.
 */
export async function emit(ctx: AppContext, jobId: string, name: string, data: unknown): Promise<void> {
  ctx.sse.broadcast(jobId, name, data);
  await ctx.jobStore.appendEvent(jobId, name, data).catch(() => {});
}

/** Send the full job snapshot (sent on connect and on every status change). */
export async function emitJob(ctx: AppContext, job: Job): Promise<void> {
  await emit(ctx, job.id, "job", job);
}
