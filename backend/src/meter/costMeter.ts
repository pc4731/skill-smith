import type { ResultInfo } from "../claude/events.js";
import type { Meter } from "../jobs/types.js";

/** A fresh, empty meter with the per-job invocation ceiling baked in. */
export function emptyMeter(ceiling: number): Meter {
  return { calls: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, ceiling, ceilingHit: false };
}

/** Fold one completed invocation's usage into the meter (returns a new object). */
export function applyResult(meter: Meter, info: Pick<ResultInfo, "totalCostUsd" | "inputTokens" | "outputTokens">): Meter {
  return {
    ...meter,
    calls: meter.calls + 1,
    inputTokens: meter.inputTokens + (info.inputTokens || 0),
    outputTokens: meter.outputTokens + (info.outputTokens || 0),
    totalCostUsd: round6(meter.totalCostUsd + (info.totalCostUsd || 0)),
  };
}

/** True when starting another invocation would exceed the per-job ceiling. */
export function ceilingReached(meter: Meter): boolean {
  return meter.calls >= meter.ceiling;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
