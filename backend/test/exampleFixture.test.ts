import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Job } from "../src/jobs/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exampleDir = path.join(repoRoot, "workspace", "examples", "example-spring-boot");

/**
 * The committed example job is a real, browsable end-to-end artifact. This test makes the
 * fixture fail loudly if the on-disk schema drifts away from the current Job/ResultsState types.
 */
describe("committed example fixture", () => {
  it("loads workspace/examples/example-spring-boot and matches the completed-job shape", () => {
    const job = JSON.parse(fs.readFileSync(path.join(exampleDir, "job.json"), "utf8")) as Job;

    expect(job.status).toBe("done");
    expect(job.results?.status).toBe("done");
    expect(job.results?.skills.length).toBeGreaterThan(0);

    // Every delivered skill has scores, install hints, and a packaged .skill on disk.
    for (const s of job.results!.skills) {
      expect(s.installHints.personal).toContain(s.slug);
      if (s.packageRelPath) {
        expect(fs.existsSync(path.join(exampleDir, "skills", s.packageRelPath))).toBe(true);
      }
      expect(fs.existsSync(path.join(exampleDir, "skills", s.slug, "SKILL.md"))).toBe(true);
    }

    // results.json on disk mirrors job.results.
    const results = JSON.parse(fs.readFileSync(path.join(exampleDir, "results.json"), "utf8"));
    expect(results.skills.length).toBe(job.results!.skills.length);
  });
});
