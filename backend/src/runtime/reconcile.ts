import type { AppContext } from "../context.js";

const RESTART_NOTE = "interrupted by server restart";

/**
 * Stage runners live in memory and do NOT survive a process restart. On boot,
 * any job left with a stage mid-execution ('running') is an orphan: reconcile it
 * to a terminal 'failed' state so the UI shows a real outcome instead of a
 * perpetual spinner. Jobs that are legitimately PARKED (awaiting_input /
 * awaiting_approval — no running stage) are left untouched and remain resumable
 * via the existing answers/plan/research endpoints. Returns the count reconciled.
 */
export async function reconcileOrphans(ctx: AppContext): Promise<number> {
  const jobs = await ctx.jobStore.list();
  let reconciled = 0;
  for (const job of jobs) {
    const hasRunningStage = job.stages.some((s) => s.status === "running");
    if (!hasRunningStage) continue;
    await ctx.jobStore
      .update(job.id, (j) => {
        const now = new Date().toISOString();
        for (const s of j.stages) {
          if (s.status === "running") {
            s.status = "failed";
            s.error = RESTART_NOTE;
            s.endedAt = now;
          }
        }
        j.status = "failed";
        j.note = j.note ? `${j.note}; ${RESTART_NOTE}` : RESTART_NOTE;
      })
      .catch(() => undefined);
    reconciled++;
  }
  return reconciled;
}
