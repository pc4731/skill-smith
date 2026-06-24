import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultsView } from "../components/ResultsView.js";
import type { ResultsState } from "../types.js";

const results: ResultsState = {
  status: "done",
  packageAllRelPath: "all-skills.zip",
  skills: [
    {
      name: "springboot-rest", slug: "springboot-rest", passed: true, triggerRate: 1, capabilityScore: 0.9,
      descriptionChars: 80, bodyLines: 40,
      sources: [{ title: "Spring docs", url: "https://spring.io" }],
      packageRelPath: "springboot-rest.skill",
      installHints: { personal: "~/.claude/skills/springboot-rest/", project: ".claude/skills/springboot-rest/" },
    },
  ],
};

describe("ResultsView", () => {
  it("renders a card per skill with score, sources, install hints and a download link", () => {
    render(<ResultsView jobId="job-1" results={results} />);
    expect(screen.getByText("springboot-rest")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument(); // trigger rate
    // install hints
    expect(screen.getByText("~/.claude/skills/springboot-rest/")).toBeInTheDocument();
    expect(screen.getByText(".claude/skills/springboot-rest/")).toBeInTheDocument();
    // download links point at the backend endpoints
    const dl = screen.getByRole("link", { name: /download .skill/i });
    expect(dl).toHaveAttribute("href", "/api/jobs/job-1/skills/springboot-rest/package");
    const all = screen.getByRole("link", { name: /download all/i });
    expect(all).toHaveAttribute("href", "/api/jobs/job-1/download-all");
  });

  it("renders nothing without results", () => {
    const { container } = render(<ResultsView jobId="job-1" results={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
