import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { testConfig, sleep } from "./helpers.js";

async function pollJob(app: Express, id: string, predicate: (j: any) => boolean, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/jobs/${id}`);
    if (res.status === 200 && predicate(res.body)) return res.body;
    await sleep(40);
  }
  const last = await request(app).get(`/api/jobs/${id}`);
  throw new Error(`pollJob timed out; last=${JSON.stringify(last.body)}`);
}

describe("API (mocked claude)", () => {
  it("say-hi round-trip completes and records cost/usage", async () => {
    const { app } = createApp({ config: testConfig(), heartbeatMs: 0 });
    const create = await request(app).post("/api/say-hi");
    expect(create.status).toBe(201);
    const id = create.body.id as string;
    const job = await pollJob(app, id, (j) => j.status === "done");
    expect(job.meter.calls).toBeGreaterThanOrEqual(1);
    expect(job.stages.find((s: any) => s.key === "scope").status).toBe("done");
  });

  it("POST /jobs runs Stage 0 and parks awaiting user input with <=5 questions", async () => {
    const { app } = createApp({ config: testConfig(), heartbeatMs: 0 });
    const create = await request(app).post("/api/jobs").send({ description: "AEM project with React" });
    expect(create.status).toBe(201);
    const id = create.body.id as string;
    const job = await pollJob(app, id, (j) => j.status === "awaiting_input");
    expect(Array.isArray(job.questions)).toBe(true);
    expect(job.questions.length).toBeGreaterThan(0);
    expect(job.questions.length).toBeLessThanOrEqual(5);
    // Stages 1-5 are still pending in this phase.
    const nonScopePending = job.stages.filter((s: any) => s.key !== "scope").every((s: any) => s.status === "pending");
    expect(nonScopePending).toBe(true);
  });

  it("answers persist scope.json and mark Stage 0 done", async () => {
    const { app } = createApp({ config: testConfig(), heartbeatMs: 0 });
    const id = (await request(app).post("/api/jobs").send({ description: "x" })).body.id as string;
    await pollJob(app, id, (j) => j.status === "awaiting_input");
    const ans = await request(app)
      .post(`/api/jobs/${id}/answers`)
      .send({ answers: { q1: "A", q2: ["x"], q3: "no constraints" } });
    expect(ans.status).toBe(200);
    expect(ans.body.scope.answers.q1).toBe("A");
    const job = await request(app).get(`/api/jobs/${id}`);
    expect(job.body.stages.find((s: any) => s.key === "scope").status).toBe("done");
  });

  it("'use defaults' fills answers from the first option without user input", async () => {
    const { app } = createApp({ config: testConfig(), heartbeatMs: 0 });
    const id = (await request(app).post("/api/jobs").send({ description: "x" })).body.id as string;
    await pollJob(app, id, (j) => j.status === "awaiting_input");
    const ans = await request(app).post(`/api/jobs/${id}/answers`).send({ useDefaults: true });
    expect(ans.status).toBe(200);
    expect(ans.body.scope.usedDefaults).toBe(true);
    expect(ans.body.scope.answers.q1).toBe("A"); // first option of the single-select
  });

  it("validates input and missing jobs", async () => {
    const { app } = createApp({ config: testConfig(), heartbeatMs: 0 });
    expect((await request(app).post("/api/jobs").send({})).status).toBe(400);
    expect((await request(app).get("/api/jobs/does-not-exist")).status).toBe(404);
    expect((await request(app).get("/api/jobs/does-not-exist/stream")).status).toBe(404);
  });

  it("is refresh/restart-safe: a fresh app instance reads the same job from disk", async () => {
    const config = testConfig();
    const a = createApp({ config, heartbeatMs: 0 });
    const id = (await request(a.app).post("/api/jobs").send({ description: "persist me" })).body.id as string;
    await pollJob(a.app, id, (j) => j.status === "awaiting_input");

    const b = createApp({ config, heartbeatMs: 0 }); // simulates a server restart
    const reread = await request(b.app).get(`/api/jobs/${id}`);
    expect(reread.status).toBe(200);
    expect(reread.body.description).toBe("persist me");
    expect(reread.body.questions.length).toBeGreaterThan(0);
  });
});
