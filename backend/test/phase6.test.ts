import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context.js";
import { reconcileOrphans } from "../src/runtime/reconcile.js";
import { createApp } from "../src/server.js";
import { testConfig } from "./helpers.js";

describe("Phase 6 — history, re-run, restart reconciliation", () => {
  it("GET /api/jobs returns compact summaries, newest-first", async () => {
    const config = testConfig();
    const ctx = buildContext({ config, heartbeatMs: 0 });
    const older = await ctx.jobStore.create({ description: "older job", ceiling: 150 });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await ctx.jobStore.create({ description: "newer job", ceiling: 150 });

    const { app } = createApp({ config, heartbeatMs: 0 });
    const res = await request(app).get("/api/jobs");
    expect(res.status).toBe(200);
    const ids = res.body.map((j: any) => j.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id)); // newest-first
    const summary = res.body.find((j: any) => j.id === newer.id);
    expect(summary).toMatchObject({ description: "newer job", status: "active", skillCount: 0 });
    expect(summary).toHaveProperty("cost");
    expect(summary).toHaveProperty("calls");
    expect(summary).not.toHaveProperty("research"); // it's a summary, not the full job
  });

  it("POST /api/jobs/:id/rerun creates a distinct new job from the source description without mutating it", async () => {
    const config = testConfig();
    const ctx = buildContext({ config, heartbeatMs: 0 });
    const source = await ctx.jobStore.create({ description: "Spring Boot REST + SOAP", ceiling: 150 });

    const { app } = createApp({ config, heartbeatMs: 0 });
    const res = await request(app).post(`/api/jobs/${source.id}/rerun`);
    expect(res.status).toBe(202);
    expect(res.body.id).toBeTruthy();
    expect(res.body.id).not.toBe(source.id);

    const clone = await ctx.jobStore.get(res.body.id);
    expect(clone?.description).toBe("Spring Boot REST + SOAP");
    // source is untouched
    const after = await ctx.jobStore.get(source.id);
    expect(after?.description).toBe("Spring Boot REST + SOAP");
    expect(after?.id).toBe(source.id);

    expect((await request(app).post(`/api/jobs/does-not-exist/rerun`)).status).toBe(404);
  });

  it("reconcileOrphans flips a job left mid-stage to failed on boot; leaves parked jobs alone", async () => {
    const config = testConfig();
    const ctx = buildContext({ config, heartbeatMs: 0 });
    const running = await ctx.jobStore.create({ description: "interrupted", ceiling: 150 });
    await ctx.jobStore.update(running.id, (j) => {
      const s = j.stages.find((x) => x.key === "research");
      if (s) s.status = "running";
      j.status = "active";
    });
    const parked = await ctx.jobStore.create({ description: "parked", ceiling: 150 });
    await ctx.jobStore.update(parked.id, (j) => {
      const s = j.stages.find((x) => x.key === "scope");
      if (s) s.status = "awaiting_input";
      j.status = "awaiting_input";
    });

    const n = await reconcileOrphans(ctx);
    expect(n).toBe(1);

    const afterRunning = await ctx.jobStore.get(running.id);
    expect(afterRunning?.status).toBe("failed");
    expect(afterRunning?.stages.find((s) => s.key === "research")?.status).toBe("failed");
    expect(afterRunning?.note).toMatch(/interrupted by server restart/);

    const afterParked = await ctx.jobStore.get(parked.id);
    expect(afterParked?.status).toBe("awaiting_input"); // untouched
  });
});
