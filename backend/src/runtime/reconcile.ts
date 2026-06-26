import type { AppContext } from "../context.js";
import { resumeStage1 } from "../stages/stage1Research.js";
import { resumeStage3 } from "../stages/stage3Generate.js";
import { resumeStage4 } from "../stages/stage4SelfTest.js";

const RESTART_NOTE = "interrupted by server restart";

export interface ReconcileResult {
  /** Jobs flipped to a terminal 'failed' state (no incremental resume available). */
  reconciled: number;
  /** Jobs auto-resumed from disk (completed items kept, the rest re-run). */
  resumed: number;
}

/**
 * Stage runners live in memory and do NOT survive a process restart. On boot,
 * any job left with a stage mid-execution ('running') is an orphan.
 *
 * The per-item stages are incrementally resumable from disk, so we AUTO-RESUME
 * a job interrupted in one of them — finished items are reused and only the
 * unfinished ones re-run:
 *   - research (Stage 1): completed domains persisted to research/<slug>.json
 *   - generate (Stage 3): skills with a valid SKILL.md on disk
 *   - test     (Stage 4): skills with a passing report.json on disk
 * Any other interrupted stage has no on-disk resume point, so it is reconciled
 * to 'failed' to avoid a perpetual spinner. Jobs that are legitimately PARKED
 * (awaiting_input / awaiting_approval — no running stage) are left untouched and
 * remain resumable via the existing answers/plan/research/generate/test endpoints.
 */
export async function reconcileOrphans(ctx: AppContext): Promise<ReconcileResult> {
  const jobs = await ctx.jobStore.list();
  let reconciled = 0;
  let resumed = 0;
  for (const job of jobs) {
    const runningStages = job.stages.filter((s) => s.status === "running");
    if (runningStages.length === 0) continue;

    // A single interrupted per-item stage can be auto-resumed from disk.
    // (Stages run sequentially, so at most one is ever 'running'.)
    const runningKeys = new Set(runningStages.map((s) => s.key));
    const onlyStage = runningStages[0];
    if (runningKeys.size === 1 && onlyStage) {
      const only = onlyStage.key;
      // Fire-and-forget: each resume re-derives done vs. pending items from disk.
      if (only === "research" && job.scope) {
        void resumeStage1(ctx, job.id).catch(() => undefined);
        resumed++;
        continue;
      }
      if (only === "generate" && (job.design?.skills?.length ?? 0) > 0) {
        void resumeStage3(ctx, job.id).catch(() => undefined);
        resumed++;
        continue;
      }
      if (only === "test" && job.generation?.skills?.some((s) => s.status === "done")) {
        void resumeStage4(ctx, job.id).catch(() => undefined);
        resumed++;
        continue;
      }
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
