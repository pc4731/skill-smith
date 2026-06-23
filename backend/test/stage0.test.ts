import { afterEach, describe, expect, it } from "vitest";
import { buildContext } from "../src/context.js";
import { applyAnswers, runStage0 } from "../src/stages/stage0Scope.js";
import { testConfig } from "./helpers.js";

afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
});

describe("Stage 0 scoping", () => {
  it("decomposes the description into typed scope and parks awaiting input", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await ctx.jobStore.create({ description: "AEM with React", ceiling: 40 });
    await runStage0(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.status).toBe("awaiting_input");
    expect(after?.stages.find((s) => s.key === "scope")?.status).toBe("awaiting_input");
    expect(after?.scope?.targetStack).toBe("Demo stack");
    expect(after?.questions?.length).toBe(3);
    expect((after?.questions?.length ?? 0)).toBeLessThanOrEqual(5);
    expect(after?.meter.calls).toBe(1); // cost meter incremented
  });

  it("answer path persists the user's answers to scope.json and marks Stage 0 done", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await ctx.jobStore.create({ description: "x", ceiling: 40 });
    await runStage0(ctx, job.id);

    const scope = await applyAnswers(ctx, job.id, {
      answers: { q1: "B", q2: ["x", "y"], q3: "must be offline-first" },
    });
    expect(scope.usedDefaults).toBe(false);
    expect(scope.answers?.q1).toBe("B");
    expect(scope.answers?.q3).toBe("must be offline-first");

    const after = await ctx.jobStore.get(job.id);
    expect(after?.stages.find((s) => s.key === "scope")?.status).toBe("done");
    // Pipeline must NOT advance past Stage 0 this phase.
    const laterPending = after?.stages
      .filter((s) => s.key !== "scope")
      .every((s) => s.status === "pending");
    expect(laterPending).toBe(true);
  });

  it("use-defaults path fills answers from the first option / empty text", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await ctx.jobStore.create({ description: "x", ceiling: 40 });
    await runStage0(ctx, job.id);

    const scope = await applyAnswers(ctx, job.id, { useDefaults: true });
    expect(scope.usedDefaults).toBe(true);
    expect(scope.answers?.q1).toBe("A"); // first option of single-select
    expect(scope.answers?.q2).toEqual(["x"]); // first option of multi-select
    expect(scope.answers?.q3).toBe(""); // text default
  });

  it("stops gracefully when the per-job invocation ceiling is already reached", async () => {
    const ctx = buildContext({ config: testConfig({ perJobInvocationCeiling: 1 }), heartbeatMs: 0 });
    const job = await ctx.jobStore.create({ description: "x", ceiling: 1 });
    await ctx.jobStore.update(job.id, (j) => {
      j.meter.calls = 1; // ceiling already hit
    });
    await runStage0(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.status).toBe("failed");
    expect(after?.stages.find((s) => s.key === "scope")?.status).toBe("failed");
    expect(after?.scope).toBeUndefined(); // no claude call was made
  });
});
