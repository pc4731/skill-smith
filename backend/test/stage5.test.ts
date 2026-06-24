import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context.js";
import { allPackagePath, packagePath, skillDir } from "../src/jobs/jobPaths.js";
import { createApp } from "../src/server.js";
import { runStage5 } from "../src/stages/stage5Package.js";
import { testConfig } from "./helpers.js";

function writeValidSkill(dir: string, slug: string) {
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${slug}\ndescription: Use this skill whenever working with ${slug}.\n---\n\n# ${slug}\n\nBody.\n`,
  );
  fs.writeFileSync(path.join(dir, "references", "overview.md"), `# ${slug}\n`);
}

interface SkillSpec { slug: string; valid: boolean; passed?: boolean }

async function jobReadyToPackage(ctx: any, specs: SkillSpec[]) {
  const job = await ctx.jobStore.create({ description: "x", ceiling: 150 });
  await ctx.jobStore.update(job.id, (j: any) => {
    j.design = { status: "done", skills: specs.map((s) => ({ name: s.slug, slug: s.slug, description: "d", scopeBoundaries: "b", sourceDomains: ["alpha"] })) };
    j.generation = { status: "done", skills: specs.map((s) => ({ name: s.slug, slug: s.slug, status: "done" })) };
    j.selftest = { status: "done", skills: specs.map((s) => ({ name: s.slug, slug: s.slug, status: "done", triggerRate: 1, capabilityScore: 0.9, passed: s.passed ?? true })) };
  });
  await ctx.jobStore.writeBrief(job.id, "alpha", {
    domain: "alpha", key_apis: ["A()"], idioms: [], gotchas: [], version_notes: "v1",
    sources: [{ title: "docs", url: "https://e.com" }, { title: "rel", url: "https://e.com/r" }],
  });
  for (const s of specs) {
    const dir = skillDir(ctx.config.workspaceDir, job.id, s.slug);
    if (s.valid) writeValidSkill(dir, s.slug);
    else fs.mkdirSync(dir, { recursive: true }); // missing SKILL.md -> invalid
  }
  return job;
}

function isZip(file: string): boolean {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(2);
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  return buf.toString("latin1") === "PK";
}

describe("runStage5 (package + results)", () => {
  it("validates, packages each skill to a .skill, and assembles results.json", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await jobReadyToPackage(ctx, [{ slug: "alpha-skill", valid: true }, { slug: "beta-skill", valid: true }]);
    await runStage5(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.results?.status).toBe("done");
    expect(after?.status).toBe("done");
    expect(after?.stages.find((s) => s.key === "package")?.status).toBe("done");

    for (const slug of ["alpha-skill", "beta-skill"]) {
      const pkg = packagePath(ctx.config.workspaceDir, job.id, slug);
      expect(fs.existsSync(pkg)).toBe(true);
      expect(isZip(pkg)).toBe(true);
      const r = after?.results?.skills.find((s) => s.slug === slug);
      expect(r?.packageRelPath).toBe(`${slug}.skill`);
      expect(r?.sources.length).toBe(2);
      expect(r?.installHints.personal).toBe(`~/.claude/skills/${slug}/`);
      expect(r?.triggerRate).toBe(1);
    }
    expect(fs.existsSync(allPackagePath(ctx.config.workspaceDir, job.id))).toBe(true);
    expect(fs.existsSync(path.join(ctx.jobStore.dir(job.id), "results.json"))).toBe(true);
  });

  it("marks an invalid skill failed and ends done_with_warnings", async () => {
    const ctx = buildContext({ config: testConfig(), heartbeatMs: 0 });
    const job = await jobReadyToPackage(ctx, [{ slug: "good-skill", valid: true }, { slug: "broken-skill", valid: false }]);
    await runStage5(ctx, job.id);

    const after = await ctx.jobStore.get(job.id);
    expect(after?.results?.status).toBe("done_with_warnings");
    expect(after?.results?.skills.find((s) => s.slug === "good-skill")?.packageRelPath).toBeTruthy();
    expect(after?.results?.skills.find((s) => s.slug === "broken-skill")?.error).toBeTruthy();
    expect(fs.existsSync(packagePath(ctx.config.workspaceDir, job.id, "broken-skill"))).toBe(false);
  });

  it("serves SKILL.md, the .skill package, download-all, and 404s for missing", async () => {
    const config = testConfig();
    const a = buildContext({ config, heartbeatMs: 0 });
    const job = await jobReadyToPackage(a, [{ slug: "alpha-skill", valid: true }]);
    await runStage5(a, job.id);

    const { app } = createApp({ config, heartbeatMs: 0 });
    const md = await request(app).get(`/api/jobs/${job.id}/skills/alpha-skill/SKILL.md`);
    expect(md.status).toBe(200);
    expect(md.text).toContain("name: alpha-skill");

    const pkg = await request(app).get(`/api/jobs/${job.id}/skills/alpha-skill/package`);
    expect(pkg.status).toBe(200);
    expect(pkg.headers["content-disposition"]).toContain("alpha-skill.skill");

    const all = await request(app).get(`/api/jobs/${job.id}/download-all`);
    expect(all.status).toBe(200);

    expect((await request(app).get(`/api/jobs/${job.id}/skills/nope/package`)).status).toBe(404);
    expect((await request(app).get(`/api/jobs/${job.id}/skills/../etc/SKILL.md`)).status).toBe(404);
  });
});
