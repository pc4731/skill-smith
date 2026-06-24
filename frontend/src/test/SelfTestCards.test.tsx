import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelfTestCards } from "../components/SelfTestCards.js";
import type { SelfTestState } from "../types.js";

const selftest: SelfTestState = {
  status: "done_with_warnings",
  skills: [
    { name: "springboot-rest", slug: "springboot-rest", status: "done", triggerRate: 1, falseTriggerRate: 0, capabilityScore: 0.9, passed: true },
    { name: "springboot-jpa", slug: "springboot-jpa", status: "failed", triggerRate: 0.4, falseTriggerRate: 0, capabilityScore: 0.3, passed: false, error: "capability score too low" },
  ],
};

describe("SelfTestCards", () => {
  it("renders a card per skill with trigger rate, capability score and pass/fail", () => {
    render(<SelfTestCards selftest={selftest} />);
    expect(screen.getByText("springboot-rest")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument(); // triggerRate of the passing skill
    expect(screen.getByText("capability score too low")).toBeInTheDocument();
    expect(screen.getByText(/some skills failed self-test/i)).toBeInTheDocument();
  });

  it("renders nothing without self-test data", () => {
    const { container } = render(<SelfTestCards selftest={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
