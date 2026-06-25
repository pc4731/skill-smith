import type { AppContext } from "../context.js";
import { resumeStage1 } from "../stages/stage1Research.js";

const RESTART_NOTE = "interrupted by server restart";

export interface ReconcileResult {
  /** Jobs flipped to a terminal 'failed' state (no incremental resume available). */
  reconciled: number;
  /** Research jobs auto-resumed from disk (completed domains kept, the rest re-run). */
  resumed: number;
}

/**
 * Stage runners live in memory and do NOT survive a process restart. On boot,
 * any job left with a stage mid-execution ('running') is an orphan.
 *
 * Stage 1 (research) is incrementally resumable: completed domains are persisted
 * to research/<slug>.json and each in-flight domain carries a session id, so we
 * AUTO-RESUME those jobs — finished domains are reused and only the unfinished
 * ones re-run (resuming their session where possible). Any other interrupted
 * stage has no on-disk resume point, so it is reconciled to 'failed' to avoid a
 * perpetual spinner. Jobs that are legitimately PARKED (awaiting_input /
 * awaiting_approval — no running stage) are left untouched and remain resumable
 * via the existing answers/plan/research endpoints.
 */
export async function reconcileOrphans(ctx: AppContext): Promise<ReconcileResult> {
  const jobs = await ctx.jobStore.list();
  let reconciled = 0;
  let resumed = 0;
  for (const job of jobs) {
    const runningStages = job.stages.filter((s) => s.status === "running");
    if (runningStages.length === 0) continue;

    // Interrupted purely during research, and the scope is answered → auto-resume.
    const onlyResearchRunning = runningStages.every((s) => s.key === "research");
    if (onlyResearchRunning && job.scope) {
      // Fire-and-forget: resumeStage1 re-derives done vs. pending domains from disk.
      void resumeStage1(ctx, job.id).catch(() => undefined);
      resumed++;
      continue;
    }

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
  return { reconciled, resumed };
}
