import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper } from "../components/Stepper.js";
import type { Job } from "../types.js";

function job(scopeStatus: Job["stages"][number]["status"]): Job {
  return {
    id: "j1",
    kind: "skill",
    status: "awaiting_input",
    description: "demo",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    stages: [
      { key: "scope", status: scopeStatus },
      { key: "research", status: "pending" },
      { key: "design", status: "pending" },
      { key: "generate", status: "pending" },
      { key: "test", status: "pending" },
      { key: "package", status: "pending" },
    ],
    meter: { calls: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, ceiling: 40, ceilingHit: false },
  };
}

describe("Stepper", () => {
  it("renders all six stage labels", () => {
    render(<Stepper job={job("awaiting_input")} />);
    for (const label of ["Scope", "Research", "Design", "Generate", "Test", "Package"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks Stages 2-6 as pending and reflects the scope stage status", () => {
    render(<Stepper job={job("awaiting_input")} />);
    // research/design/generate/test/package = 5 pending
    expect(screen.getAllByText("Pending").length).toBe(5);
    expect(screen.getByText("Awaiting input")).toBeInTheDocument();
  });
});
