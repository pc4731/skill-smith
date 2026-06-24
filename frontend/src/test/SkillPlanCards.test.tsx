import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillCards } from "../components/SkillCards.js";
import { SkillPlan } from "../components/SkillPlan.js";
import type { DesignState, GenerationState } from "../types.js";

const design: DesignState = {
  status: "awaiting_approval",
  skills: [
    { name: "springboot-rest", slug: "springboot-rest", description: "Use when building REST controllers.", scopeBoundaries: "REST only", sourceDomains: ["rest"] },
    { name: "springboot-jpa", slug: "springboot-jpa", description: "Use for JPA persistence.", scopeBoundaries: "persistence", sourceDomains: ["jpa"] },
  ],
};

const generation: GenerationState = {
  status: "done_with_warnings",
  skills: [
    { name: "springboot-rest", slug: "springboot-rest", status: "done", validation: { ok: true, descriptionChars: 80, bodyLines: 40, hasReferences: true, issues: [] } },
    { name: "springboot-jpa", slug: "springboot-jpa", status: "failed", error: "SKILL.md missing" },
  ],
};

describe("SkillPlan", () => {
  it("lists each proposed skill and approves", async () => {
    const onApprove = vi.fn();
    render(<SkillPlan design={design} onApprove={onApprove} />);
    expect(screen.getByText("springboot-rest")).toBeInTheDocument();
    expect(screen.getByText("springboot-jpa")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /approve & generate/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});

describe("SkillCards", () => {
  it("renders a card per generated skill with validation / error", () => {
    render(<SkillCards generation={generation} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("SKILL.md missing")).toBeInTheDocument();
    expect(screen.getByText(/some skills failed validation/i)).toBeInTheDocument();
  });

  it("renders nothing without generation", () => {
    const { container } = render(<SkillCards generation={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
