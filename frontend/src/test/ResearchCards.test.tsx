import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResearchCards } from "../components/ResearchCards.js";
import type { ResearchState } from "../types.js";

const research: ResearchState = {
  status: "done_with_warnings",
  domains: [
    { domain: "react-hooks", slug: "react-hooks", status: "done", summary: { keyApis: 3, gotchas: 2, sources: 4 } },
    { domain: "aem-spa", slug: "aem-spa", status: "running" },
    { domain: "broken", slug: "broken", status: "failed", error: "network error" },
  ],
};

describe("ResearchCards", () => {
  it("renders one card per domain with its status", () => {
    render(<ResearchCards research={research} />);
    expect(screen.getByText("react-hooks")).toBeInTheDocument();
    expect(screen.getByText("aem-spa")).toBeInTheDocument();
    expect(screen.getByText("broken")).toBeInTheDocument();
    expect(screen.getByText("Researching…")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows the brief summary counts for done domains", () => {
    render(<ResearchCards research={research} />);
    // done domain renders APIs/Gotchas/Sources counts
    expect(screen.getByText("APIs")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // keyApis
    expect(screen.getByText("4")).toBeInTheDocument(); // sources
    expect(screen.getByText("network error")).toBeInTheDocument();
  });

  it("renders nothing when there is no research yet", () => {
    const { container } = render(<ResearchCards research={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
