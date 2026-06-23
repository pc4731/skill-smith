import { describe, expect, it } from "vitest";
import { applyResult, ceilingReached, emptyMeter } from "../src/meter/costMeter.js";

describe("costMeter", () => {
  it("aggregates calls, tokens, and cost across invocations", () => {
    let m = emptyMeter(10);
    m = applyResult(m, { totalCostUsd: 0.001, inputTokens: 100, outputTokens: 50 });
    m = applyResult(m, { totalCostUsd: 0.002, inputTokens: 20, outputTokens: 5 });
    expect(m.calls).toBe(2);
    expect(m.inputTokens).toBe(120);
    expect(m.outputTokens).toBe(55);
    expect(m.totalCostUsd).toBeCloseTo(0.003, 6);
  });

  it("reports the ceiling as reached only once calls hit it", () => {
    let m = emptyMeter(2);
    expect(ceilingReached(m)).toBe(false);
    m = applyResult(m, { totalCostUsd: 0, inputTokens: 0, outputTokens: 0 });
    expect(ceilingReached(m)).toBe(false);
    m = applyResult(m, { totalCostUsd: 0, inputTokens: 0, outputTokens: 0 });
    expect(ceilingReached(m)).toBe(true);
  });
});
