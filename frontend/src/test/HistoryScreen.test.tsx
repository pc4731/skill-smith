import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryScreen } from "../screens/HistoryScreen.js";
import type { JobSummary } from "../types.js";

const summaries: JobSummary[] = [
  { id: "j2", kind: "skill", description: "newer job", status: "done", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z", skillCount: 3, cost: 0.42, calls: 12 },
  { id: "j1", kind: "skill", description: "older job", status: "failed", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", skillCount: 0, cost: 0.01, calls: 1 },
];

afterEach(() => vi.restoreAllMocks());

describe("HistoryScreen", () => {
  it("renders past jobs from the API with status, skills and cost", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(summaries), { status: 200, headers: { "content-type": "application/json" } })));
    render(<MemoryRouter><HistoryScreen /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("newer job")).toBeInTheDocument());
    expect(screen.getByText("older job")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("re-run posts to the rerun endpoint", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/rerun")) {
        return new Response(JSON.stringify({ id: "new-job" }), { status: 202, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(summaries), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter><HistoryScreen /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("newer job")).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole("button", { name: /re-run/i })[0]!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/jobs/j2/rerun", expect.objectContaining({ method: "POST" })),
    );
  });
});
