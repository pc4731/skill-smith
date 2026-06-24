import fs from "node:fs";
import archiver from "archiver";
import type { AppContext } from "../context.js";
import { allPackagePath, packagePath, skillDir } from "../jobs/jobPaths.js";
import path from "node:path";
import type { ResultSkill, ResultsState } from "../jobs/types.js";
import { emit, emitJob } from "../runtime/broadcast.js";
import { readBriefs } from "./stage2Design.js";
import { validateSkill } from "./stage3Generate.js";

/** Files inside a skill dir that must NOT ship in the .skill (internals / scratch). */
const PACKAGE_IGNORE = ["report.json", ".cap/**"];

/** Zip a skill directory into a .skill archive (excluding internals). Resolves on close. */
function zipSkill(srcDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    archive.glob("**/*", { cwd: srcDir, ignore: PACKAGE_IGNORE, dot: false });
    void archive.finalize();
  });
}

/** Build the combined "download all" zip: each skill under its slug folder. */
function zipAll(jobSkillsDirs: Array<{ slug: string; dir: string }>, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    for (const s of jobSkillsDirs) {
      archive.glob("**/*", { cwd: s.dir, ignore: PACKAGE_IGNORE, dot: false }, { prefix: s.slug });
    }
    void archive.finalize();
  });
}

/**
 * Stage 5 — package & deliver. DETERMINISTIC (no claude calls): validate each
 * generated skill, zip it to a .skill, assemble results.json with the self-test
 * scores + cited sources + install hints, and build a combined download-all zip.
 */
export async function runStage5(ctx: AppContext, jobId: string): Promise<void> {
  const job = await ctx.jobStore.get(jobId);
  const generated = job?.generation?.skills.filter((s) => s.status === "done") ?? [];
  const plan = job?.design?.skills ?? [];
  if (generated.length === 0) return;

  await ctx.jobStore.update(jobId, (j) => {
    j.results = { status: "running", skills: [] };
    const stage = j.stages.find((s) => s.key === "package");
    if (stage) {
      stage.status = "running";
      stage.startedAt = new Date().toISOString();
    }
    j.status = "active";
  });
  await emit(ctx, jobId, "stage", { stageKey: "package", status: "running" });

  const briefs = await readBriefs(ctx, jobId);
  const results: ResultSkill[] = [];
  const packagedDirs: Array<{ slug: string; dir: string }> = [];

  for (const g of generated) {
    const planItem = plan.find((p) => p.slug === g.slug);
    const selftest = job?.selftest?.skills.find((s) => s.slug === g.slug);
    const dir = skillDir(ctx.config.workspaceDir, jobId, g.slug);
    const validation = validateSkill(dir);
    const installHints = {
      personal: `~/.claude/skills/${g.slug}/`,
      project: `.claude/skills/${g.slug}/`,
    };
    const sources = collectSources(planItem?.sourceDomains ?? [], briefs);

    if (!validation.ok) {
      const item: ResultSkill = {
        name: g.name, slug: g.slug, passed: false,
        triggerRate: selftest?.triggerRate, capabilityScore: selftest?.capabilityScore,
        descriptionChars: validation.descriptionChars, bodyLines: validation.bodyLines,
        sources, installHints, error: validation.issues.join("; "),
      };
      results.push(item);
      await emit(ctx, jobId, "package", { name: g.name, slug: g.slug, status: "failed", error: item.error });
      continue;
    }

    try {
      const out = packagePath(ctx.config.workspaceDir, jobId, g.slug);
      await zipSkill(dir, out);
      packagedDirs.push({ slug: g.slug, dir });
      const item: ResultSkill = {
        name: g.name, slug: g.slug, passed: !!selftest?.passed,
        triggerRate: selftest?.triggerRate, capabilityScore: selftest?.capabilityScore,
        descriptionChars: validation.descriptionChars, bodyLines: validation.bodyLines,
        sources, installHints, packageRelPath: path.basename(out),
      };
      results.push(item);
      await emit(ctx, jobId, "package", { name: g.name, slug: g.slug, status: "done", passed: item.passed });
    } catch (err) {
      const item: ResultSkill = {
        name: g.name, slug: g.slug, passed: false,
        triggerRate: selftest?.triggerRate, capabilityScore: selftest?.capabilityScore,
        descriptionChars: validation.descriptionChars, bodyLines: validation.bodyLines,
        sources, installHints, error: err instanceof Error ? err.message : String(err),
      };
      results.push(item);
      await emit(ctx, jobId, "package", { name: g.name, slug: g.slug, status: "failed", error: item.error });
    }
  }

  let packageAllRelPath: string | undefined;
  if (packagedDirs.length > 0) {
    const allOut = allPackagePath(ctx.config.workspaceDir, jobId);
    await zipAll(packagedDirs, allOut);
    packageAllRelPath = path.basename(allOut);
  }

  const anyOk = results.some((r) => !r.error);
  const anyFail = results.some((r) => r.error);
  const status: ResultsState["status"] = !anyOk ? "failed" : anyFail ? "done_with_warnings" : "done";
  const resultsState: ResultsState = { status, skills: results, packageAllRelPath };
  await ctx.jobStore.writeResults(jobId, resultsState);

  const finished = await ctx.jobStore.update(jobId, (j) => {
    j.results = resultsState;
    const stage = j.stages.find((s) => s.key === "package");
    if (stage) {
      stage.status = status === "failed" ? "failed" : "done";
      stage.endedAt = new Date().toISOString();
      if (status === "done_with_warnings") stage.error = "some skills failed packaging; others delivered";
    }
    // The pipeline is complete.
    j.status = status === "failed" ? "failed" : "done";
  });

  await emit(ctx, jobId, "results", resultsState);
  await emit(ctx, jobId, "stage", { stageKey: "package", status: status === "failed" ? "failed" : "done" });
  await emitJob(ctx, finished);
}

function collectSources(
  domains: string[],
  briefs: Array<{ domain: string; sources: { title: string; url: string }[] }>,
): { title: string; url: string }[] {
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const d of domains) {
    const brief = briefs.find((b) => b.domain === d);
    for (const s of brief?.sources ?? []) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      out.push(s);
    }
  }
  return out;
}
