import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { loadConfig, toolsFor } from "../src/config/config.js";
import { buildContext } from "../src/context.js";
import { slug } from "../src/jobs/jobPaths.js";
import type { Scope } from "../src/jobs/types.js";
import { deriveDomains, runStage1 } from "../src/stages/stage1Research.js";
import { testConfig } from "./helpers.js";

function scope(domains: string[]): Scope {
  return { targetStack: "Demo stack", domains, likelyTasks: [], questions: [], answers: { q1: "A" } };
}

async function jobWithScope(ctx: any, domains: string[], meterCalls = 0, ceiling = 40) {
  const job = await ctx.jobStore.create({ description: "x", ceiling });
  await ctx.jobStore.update(job.id, (j: any) => {
    j.scope = scope(domains);
    j.meter.calls = meterCalls;
    j.meter.ceiling = ceiling;
    const s = j.stages.find((st: any) => st.key === "scope");
    if (s) s.status = "done";
  });
  return job;
}

describe("deriveDomains", () => {
  it("falls back to the target stack when no domains are given", () => {
    expect(deriveDomains([], "Spring Boot")).toEqual(["Spring Boot"]);
    expect(deriveDomains(undefined, "AEM")).toEqual(["AEM"]);
  });
  it("de-dupes domains that collide on the same slug", () => {
    expect(deriveDomains(["React Hooks", "react   hooks"], "x")).toEqual(["React Hooks"]);
  });
});

describe("tool-permission contract", () => {
  it("grants web tools only to the research stage, and never shell access", () => {
    const c = loadConfig({ skipFile: true, env: {} });
    expect(toolsFor(c, "research")).toEqual(["WebSearch", "WebFetch"]);
    // No Bash: an untrusted-content-ingesting research agent must not hold shell exec.
    expect(toolsFor(c, "research")).not.toContain("Bash");
    expect(toolsFor(c, "scope")).toEqual([]);
  });
});

describe("runStage1", () => {
  it("researches each domain and persists a versioned, cited brief", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await jobWithScope(ctx, ["alpha", "beta"]);
    await runStage1(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.research?.status).toBe("done");
    expect(after?.research?.domains.every((d) => d.status === "done")).toBe(true);
    expect(after?.stages.find((s) => s.key === "research")?.status).toBe("done");
    expect(after?.meter.calls).toBe(2); // one claude call per domain

    for (const domain of ["alpha", "beta"]) {
      const file = `${ctx.jobStore.dir(job.id)}/research/${slug(domain)}.json`;
      expect(fs.existsSync(file)).toBe(true);
      const brief = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(brief.domain).toBe(domain);
      expect(brief.sources.length).toBeGreaterThanOrEqual(2);
      expect(brief.version_notes.length).toBeGreaterThan(0);
    }
  });

  it("keeps going when one domain fails (done_with_warnings, others persisted)", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await jobWithScope(ctx, ["good", "FAIL_DOMAIN"]);
    await runStage1(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.research?.status).toBe("done_with_warnings");
    const good = after?.research?.domains.find((d) => d.domain === "good");
    const bad = after?.research?.domains.find((d) => d.domain === "FAIL_DOMAIN");
    expect(good?.status).toBe("done");
    expect(bad?.status).toBe("failed");
    expect(fs.existsSync(`${ctx.jobStore.dir(job.id)}/research/${slug("good")}.json`)).toBe(true);
    expect(fs.existsSync(`${ctx.jobStore.dir(job.id)}/research/${slug("FAIL_DOMAIN")}.json`)).toBe(false);
  });

  it("stops gracefully when the per-job invocation ceiling is already reached", async () => {
    const ctx = buildContext({ config: testConfig({ perJobInvocationCeiling: 1 }), heartbeatMs: 0 });
    const job = await jobWithScope(ctx, ["alpha"], 1, 1); // ceiling already hit
    await runStage1(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.research?.status).toBe("failed");
    expect(after?.research?.domains[0]?.status).toBe("failed");
    expect(after?.stages.find((s) => s.key === "research")?.status).toBe("failed");
    expect(fs.existsSync(`${ctx.jobStore.dir(job.id)}/research/${slug("alpha")}.json`)).toBe(false);
  });
});
