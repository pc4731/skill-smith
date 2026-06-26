import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("offers a retry that fires onRetry when domains have failed and research has settled", () => {
    const settled: ResearchState = {
      status: "done_with_warnings",
      domains: [
        { domain: "ok", slug: "ok", status: "done", summary: { keyApis: 1, gotchas: 0, sources: 2 } },
        { domain: "broken", slug: "broken", status: "failed", error: "boom" },
      ],
    };
    const onRetry = vi.fn();
    render(<ResearchCards research={settled} onRetry={onRetry} />);
    const btn = screen.getByRole("button", { name: /Retry 1 failed domain/i });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the retry button while research is still running or when nothing failed", () => {
    const running: ResearchState = {
      status: "running",
      domains: [{ domain: "broken", slug: "broken", status: "failed", error: "boom" }],
    };
    const { rerender } = render(<ResearchCards research={running} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Retry/i })).toBeNull();

    const allDone: ResearchState = {
      status: "done",
      domains: [{ domain: "ok", slug: "ok", status: "done", summary: { keyApis: 1, gotchas: 0, sources: 2 } }],
    };
    rerender(<ResearchCards research={allDone} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Retry/i })).toBeNull();
  });
});
