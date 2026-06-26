import { describe, expect, it } from "vitest";
import type { LibrarySkill, SkillPlanItem } from "../src/jobs/types.js";
import { bestMatch, matchScore } from "../src/skills/reuse.js";

function plan(over: Partial<SkillPlanItem> = {}): SkillPlanItem {
  return {
    name: "React Hooks Helper",
    slug: "react-hooks-helper",
    description: "",
    scopeBoundaries: "React hooks and state management only",
    sourceDomains: ["react-hooks"],
    ...over,
  };
}

function lib(over: Partial<LibrarySkill> = {}): LibrarySkill {
  return {
    jobId: "job-old",
    jobDescription: "old job",
    slug: "react-hooks",
    name: "React Hooks",
    description: "Use this skill when working with React hooks, state, and effects.",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("reuse matcher", () => {
  it("scores a strongly related skill above threshold and an unrelated one near zero", () => {
    expect(matchScore(plan(), lib())).toBeGreaterThanOrEqual(0.5);
    const unrelated = lib({
      slug: "spring-soap",
      name: "Spring SOAP",
      description: "Use this skill for Spring Boot SOAP web services and WSDL.",
    });
    expect(matchScore(plan(), unrelated)).toBeLessThan(0.5);
  });

  it("bestMatch returns the top candidate above threshold and excludes the current job", () => {
    const library = [
      lib(),
      lib({ jobId: "job-x", slug: "spring-soap", name: "Spring SOAP", description: "SOAP WSDL services" }),
    ];
    const m = bestMatch(plan(), library, "job-new");
    expect(m?.skill.slug).toBe("react-hooks");

    // Same job id is excluded even if it would otherwise match.
    expect(bestMatch(plan(), [lib({ jobId: "job-self" })], "job-self")).toBeNull();
  });

  it("returns null when nothing clears the threshold", () => {
    const library = [lib({ slug: "kafka", name: "Kafka", description: "Apache Kafka producers and consumers" })];
    expect(bestMatch(plan(), library, "job-new")).toBeNull();
  });
});
