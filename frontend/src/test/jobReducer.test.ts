import { describe, expect, it } from "vitest";
import { initialState, jobReducer } from "../state/jobReducer.js";
import type { Job } from "../types.js";

function baseJob(): Job {
  return {
    id: "j1",
    kind: "skill",
    status: "active",
    description: "demo",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    stages: [
      { key: "scope", status: "running" },
      { key: "research", status: "pending" },
      { key: "design", status: "pending" },
      { key: "generate", status: "pending" },
      { key: "test", status: "pending" },
      { key: "package", status: "pending" },
    ],
    meter: { calls: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, ceiling: 40, ceilingHit: false },
  };
}

describe("jobReducer", () => {
  it("replaces job state on a full snapshot", () => {
    const job = baseJob();
    const s = jobReducer(initialState, { type: "job", job });
    expect(s.job?.id).toBe("j1");
  });

  it("patches a single stage status", () => {
    let s = jobReducer(initialState, { type: "job", job: baseJob() });
    s = jobReducer(s, { type: "stage", stageKey: "scope", status: "awaiting_input" });
    expect(s.job?.stages.find((x) => x.key === "scope")?.status).toBe("awaiting_input");
    expect(s.job?.stages.find((x) => x.key === "research")?.status).toBe("pending");
  });

  it("appends console log lines", () => {
    let s = jobReducer(initialState, { type: "log", stageKey: "scope", text: "hi" });
    s = jobReducer(s, { type: "log", stageKey: "scope", text: " there" });
    expect(s.consoleLines.map((l) => l.text).join("")).toBe("hi there");
  });

  it("updates the meter and questions", () => {
    let s = jobReducer(initialState, { type: "job", job: baseJob() });
    s = jobReducer(s, {
      type: "meter",
      meter: { calls: 1, inputTokens: 8, outputTokens: 3, totalCostUsd: 0.001, ceiling: 40, ceilingHit: false },
    });
    expect(s.job?.meter.calls).toBe(1);
    s = jobReducer(s, { type: "question", questions: [{ id: "q1", question: "?", type: "single", options: ["a"] }] });
    expect(s.job?.questions?.length).toBe(1);
  });

  it("records errors and connection status", () => {
    let s = jobReducer(initialState, { type: "error", message: "boom" });
    expect(s.error).toBe("boom");
    s = jobReducer(s, { type: "connection", status: "open" });
    expect(s.connection).toBe("open");
  });
});
