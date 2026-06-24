import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostMeter } from "../components/CostMeter.js";

describe("CostMeter", () => {
  it("renders calls, tokens, cost and a ceiling progress bar", () => {
    render(<CostMeter meter={{ calls: 30, inputTokens: 1000, outputTokens: 500, totalCostUsd: 0.1234, ceiling: 150, ceilingHit: false }} />);
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("/ 150 calls")).toBeInTheDocument();
    expect(screen.getByText("$0.1234")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: /ceiling/i });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemax", "150");
  });

  it("shows the ceiling-reached warning when hit", () => {
    render(<CostMeter meter={{ calls: 150, inputTokens: 0, outputTokens: 0, totalCostUsd: 1, ceiling: 150, ceilingHit: true }} />);
    expect(screen.getByText(/ceiling reached/i)).toBeInTheDocument();
  });
});
