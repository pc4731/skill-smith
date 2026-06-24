import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, toolsFor } from "../src/config/config.js";
import { buildContext } from "../src/context.js";
import type { Scope } from "../src/jobs/types.js";
import { applyPlan, runStage2 } from "../src/stages/stage2Design.js";
import { testConfig } from "./helpers.js";

async function jobWithBriefs(ctx: any, domains: string[]) {
  const job = await ctx.jobStore.create({ description: "x", ceiling: 40 });
  const scope: Scope = { targetStack: "Demo stack", domains, likelyTasks: [], questions: [], answers: { q1: "A" } };
  await ctx.jobStore.update(job.id, (j: any) => {
    j.scope = scope;
    const s = j.stages.find((st: any) => st.key === "scope");
    if (s) s.status = "done";
  });
  for (const d of domains) {
    await ctx.jobStore.writeBrief(job.id, d, {
      domain: d,
      key_apis: ["X.create()"],
      idioms: ["compose"],
      gotchas: ["v2 break"],
      version_notes: "v2 current",
      sources: [{ title: "docs", url: "https://e.com" }, { title: "rel", url: "https://e.com/r" }],
    });
  }
  return job;
}

describe("design tool contract", () => {
  it("grants no tools to the design stage", () => {
    const c = loadConfig({ skipFile: true, env: {} });
    expect(toolsFor(c, "design")).toEqual([]);
  });
});

describe("runStage2 (skill design)", () => {
  it("proposes a skill-set plan and parks awaiting approval", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await jobWithBriefs(ctx, ["demo-domain-a", "demo-domain-b"]);
    await runStage2(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.design?.status).toBe("awaiting_approval");
    expect(after?.status).toBe("awaiting_input");
    expect(after?.design?.skills.length).toBeGreaterThan(0);
    for (const s of after!.design!.skills) {
      expect(s.slug).toMatch(/^[a-z0-9-]+$/);
      expect(s.description.length).toBeLessThanOrEqual(1536);
    }
    expect(after?.stages.find((s) => s.key === "design")?.status).toBe("awaiting_input");
  });
});

describe("applyPlan (approve gate)", () => {
  it("writes plan.json, marks design done, and triggers generation", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await jobWithBriefs(ctx, ["demo-domain-a", "demo-domain-b"]);
    await runStage2(ctx, job.id);

    const skills = await applyPlan(ctx, job.id, { approve: true });
    expect(skills.length).toBeGreaterThan(0);

    const planPath = path.join(ctx.jobStore.dir(job.id), "plan.json");
    expect(fs.existsSync(planPath)).toBe(true);
    const after = await ctx.jobStore.get(job.id);
    expect(after?.design?.status).toBe("done");
    expect(after?.stages.find((s) => s.key === "design")?.status).toBe("done");
  });

  it("throws when there is no plan to approve", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await ctx.jobStore.create({ description: "x", ceiling: 40 });
    await expect(applyPlan(ctx, job.id, { approve: true })).rejects.toThrow();
  });
});
