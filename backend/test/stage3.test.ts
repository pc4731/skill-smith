import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, toolsFor } from "../src/config/config.js";
import { buildContext } from "../src/context.js";
import { skillDir } from "../src/jobs/jobPaths.js";
import type { SkillPlanItem } from "../src/jobs/types.js";
import { runStage3, validateSkill } from "../src/stages/stage3Generate.js";
import { testConfig } from "./helpers.js";

function planItem(name: string): SkillPlanItem {
  return { name, slug: name, description: "Use this skill when X.", scopeBoundaries: "X only", sourceDomains: ["d"] };
}

async function jobWithApprovedPlan(ctx: any, names: string[]) {
  const job = await ctx.jobStore.create({ description: "x", ceiling: 40 });
  await ctx.jobStore.update(job.id, (j: any) => {
    j.design = { status: "done", skills: names.map(planItem) };
  });
  return job;
}

describe("generate tool contract", () => {
  it("grants file tools but NO web tools and NO shell to the generate stage", () => {
    const c = loadConfig({ skipFile: true, env: {} });
    const t = toolsFor(c, "generate");
    expect(t).toEqual(["Read", "Write", "Edit"]);
    expect(t).not.toContain("WebSearch");
    expect(t).not.toContain("WebFetch");
    expect(t).not.toContain("Bash"); // no shell for a model authoring files from web-sourced research
  });
});

describe("validateSkill", () => {
  it("flags a missing SKILL.md", () => {
    const v = validateSkill("/tmp/does-not-exist-xyz");
    expect(v.ok).toBe(false);
    expect(v.issues).toContain("SKILL.md missing");
  });
});

describe("runStage3 (generation)", () => {
  it("generates each approved skill directory with a valid SKILL.md", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await jobWithApprovedPlan(ctx, ["alpha-skill", "beta-skill"]);
    await runStage3(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.generation?.status).toBe("done");
    expect(after?.generation?.skills.every((s) => s.status === "done")).toBe(true);
    expect(after?.stages.find((s) => s.key === "generate")?.status).toBe("done");

    for (const slug of ["alpha-skill", "beta-skill"]) {
      const dir = skillDir(ctx.config.workspaceDir, job.id, slug);
      const md = path.join(dir, "SKILL.md");
      expect(fs.existsSync(md)).toBe(true);
      const v = validateSkill(dir);
      expect(v.ok).toBe(true);
      expect(v.descriptionChars).toBeLessThanOrEqual(1536);
      expect(v.bodyLines).toBeLessThanOrEqual(500);
      expect(v.hasReferences).toBe(true);
    }
  });

  it("keeps going when one skill fails to produce a SKILL.md (done_with_warnings)", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await jobWithApprovedPlan(ctx, ["good-skill", "fail-skill"]);
    await runStage3(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.generation?.status).toBe("done_with_warnings");
    expect(after?.generation?.skills.find((s) => s.slug === "good-skill")?.status).toBe("done");
    expect(after?.generation?.skills.find((s) => s.slug === "fail-skill")?.status).toBe("failed");
    expect(fs.existsSync(path.join(skillDir(ctx.config.workspaceDir, job.id, "good-skill"), "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir(ctx.config.workspaceDir, job.id, "fail-skill"), "SKILL.md"))).toBe(false);
  });
});
