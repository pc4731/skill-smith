import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, toolsFor } from "../src/config/config.js";
import { buildContext } from "../src/context.js";
import { skillDir } from "../src/jobs/jobPaths.js";
import type { SkillPlanItem } from "../src/jobs/types.js";
import { runStage4 } from "../src/stages/stage4SelfTest.js";
import { testConfig } from "./helpers.js";

function planItem(slug: string, description = "Use this skill when X."): SkillPlanItem {
  return { name: slug, slug, description, scopeBoundaries: "X only", sourceDomains: ["d"] };
}

function writeSkill(dir: string, slug: string, description: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n\nBody.\n`,
  );
}

async function jobWithGeneratedSkills(ctx: any, skills: SkillPlanItem[]) {
  const job = await ctx.jobStore.create({ description: "x", ceiling: 150 });
  await ctx.jobStore.update(job.id, (j: any) => {
    j.design = { status: "done", skills };
    j.generation = { status: "done", skills: skills.map((s) => ({ name: s.name, slug: s.slug, status: "done" })) };
  });
  for (const s of skills) writeSkill(skillDir(ctx.config.workspaceDir, job.id, s.slug), s.slug, s.description);
  return job;
}

describe("test (self-test) tool contract", () => {
  it("grants file tools but NO web/shell to the test stage", () => {
    const c = loadConfig({ skipFile: true, env: {} });
    expect(toolsFor(c, "test")).toEqual(["Read", "Write", "Edit"]);
    expect(toolsFor(c, "test")).not.toContain("Bash");
    expect(toolsFor(c, "test")).not.toContain("WebFetch");
  });

  it("does NOT leak the expected answer to the judge in production (evalLabel default false)", () => {
    const c = loadConfig({ skipFile: true, env: {} });
    expect(c.selfTest.evalLabel).toBe(false);
  });
});

describe("runStage4 (self-test)", () => {
  it("measures trigger reliability + capability and writes a passing report.json", async () => {
    const ctx = buildContext({ config: testConfig({ selfTest: { triggerThreshold: 0.8, trials: 1, maxIterations: 3, evalLabel: true } }), heartbeatMs: 0 });
    const job = await jobWithGeneratedSkills(ctx, [planItem("alpha-skill")]);
    await runStage4(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.selftest?.status).toBe("done");
    const st = after?.selftest?.skills[0];
    expect(st?.passed).toBe(true);
    expect(st?.triggerRate).toBeGreaterThanOrEqual(0.8);
    expect(st?.capabilityScore).toBeGreaterThan(0.5);
    expect(after?.stages.find((s) => s.key === "test")?.status).toBe("done");

    const report = JSON.parse(fs.readFileSync(path.join(skillDir(ctx.config.workspaceDir, job.id, "alpha-skill"), "report.json"), "utf8"));
    expect(report.passed).toBe(true);
    expect(report.prompts.shouldTrigger.length).toBeGreaterThanOrEqual(3);
  });

  it("rewrites an under-triggering description and re-tests until it clears the threshold", async () => {
    const ctx = buildContext({ config: testConfig({ selfTest: { triggerThreshold: 0.8, trials: 1, maxIterations: 3, evalLabel: true } }), heartbeatMs: 0 });
    const job = await jobWithGeneratedSkills(ctx, [planItem("lowtrig-skill")]);
    await runStage4(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    const st = after?.selftest?.skills[0];
    expect((st?.iterations ?? 0)).toBeGreaterThanOrEqual(1); // at least one rewrite happened
    expect(st?.passed).toBe(true); // after rewrite it triggers
    const md = fs.readFileSync(path.join(skillDir(ctx.config.workspaceDir, job.id, "lowtrig-skill"), "SKILL.md"), "utf8");
    expect(md).toContain("PUSHY-REWRITTEN"); // the description was rewritten on disk
  });

  it("iterates (capped) on capability failure, ending done_with_warnings", async () => {
    const ctx = buildContext({ config: testConfig({ selfTest: { triggerThreshold: 0.8, trials: 1, maxIterations: 2, evalLabel: true } }), heartbeatMs: 0 });
    const job = await jobWithGeneratedSkills(ctx, [planItem("good-skill"), planItem("lowcap-skill")]);
    await runStage4(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.selftest?.status).toBe("done_with_warnings");
    expect(after?.selftest?.skills.find((s) => s.slug === "good-skill")?.passed).toBe(true);
    const bad = after?.selftest?.skills.find((s) => s.slug === "lowcap-skill");
    expect(bad?.status).toBe("failed");
    expect(bad?.iterations).toBe(2); // capped at maxIterations
  });
});
