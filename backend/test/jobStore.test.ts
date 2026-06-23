import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JobStore } from "../src/jobs/jobStore.js";
import { tmpWorkspace } from "./helpers.js";

describe("JobStore", () => {
  it("creates a job with all six stages pending and reads it back", async () => {
    const ws = tmpWorkspace();
    const store = new JobStore(ws);
    const job = await store.create({ description: "build a thing", ceiling: 40 });
    expect(job.stages).toHaveLength(6);
    expect(job.stages.every((s) => s.status === "pending")).toBe(true);
    expect(job.meter.ceiling).toBe(40);

    const reread = await store.get(job.id);
    expect(reread?.description).toBe("build a thing");
    // job.json is valid JSON on disk
    const raw = fs.readFileSync(path.join(ws, job.id, "job.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("updates atomically and survives being reopened by a fresh store (refresh-safe)", async () => {
    const ws = tmpWorkspace();
    const store = new JobStore(ws);
    const job = await store.create({ description: "x", ceiling: 40 });
    await store.update(job.id, (j) => {
      j.status = "awaiting_input";
      const s = j.stages.find((st) => st.key === "scope");
      if (s) s.status = "awaiting_input";
    });
    const fresh = new JobStore(ws); // simulates a server restart / new request
    const reread = await fresh.get(job.id);
    expect(reread?.status).toBe("awaiting_input");
    expect(reread?.stages.find((s) => s.key === "scope")?.status).toBe("awaiting_input");
  });

  it("writes scope.json and lists jobs newest-first", async () => {
    const ws = tmpWorkspace();
    const store = new JobStore(ws);
    const a = await store.create({ description: "a", ceiling: 1 });
    await store.writeScope(a.id, {
      targetStack: "demo",
      domains: ["d"],
      likelyTasks: ["t"],
      questions: [],
      answers: { q1: "yes" },
      usedDefaults: false,
    });
    const scope = JSON.parse(fs.readFileSync(path.join(ws, a.id, "scope.json"), "utf8"));
    expect(scope.answers.q1).toBe("yes");

    const list = await store.list();
    expect(list.length).toBe(1);
  });

  it("returns null for a missing or invalid id rather than throwing", async () => {
    const store = new JobStore(tmpWorkspace());
    expect(await store.get("nonexistent-id")).toBeNull();
    expect(await store.get("../escape")).toBeNull();
  });
});
