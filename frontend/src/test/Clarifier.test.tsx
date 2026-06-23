import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Clarifier } from "../components/Clarifier.js";
import type { ScopeQuestion } from "../types.js";

const questions: ScopeQuestion[] = [
  { id: "q1", question: "Which variant?", type: "single", options: ["A", "B"] },
  { id: "q2", question: "Add-ons?", type: "multi", options: ["x", "y"] },
];

describe("Clarifier", () => {
  it("submits the user's selected answers", async () => {
    const onSubmit = vi.fn();
    const onUseDefaults = vi.fn();
    render(<Clarifier questions={questions} onSubmit={onSubmit} onUseDefaults={onUseDefaults} />);

    await userEvent.click(screen.getByRole("radio", { name: "A" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "y" }));
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const answers = onSubmit.mock.calls[0][0];
    expect(answers.q1).toBe("A");
    expect(answers.q2).toEqual(["y"]);
    expect(onUseDefaults).not.toHaveBeenCalled();
  });

  it("invokes use-defaults without requiring any selection", async () => {
    const onSubmit = vi.fn();
    const onUseDefaults = vi.fn();
    render(<Clarifier questions={questions} onSubmit={onSubmit} onUseDefaults={onUseDefaults} />);

    await userEvent.click(screen.getByRole("button", { name: /use defaults/i }));
    expect(onUseDefaults).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders each question as an accessible fieldset with its legend", () => {
    render(<Clarifier questions={questions} onSubmit={vi.fn()} onUseDefaults={vi.fn()} />);
    expect(screen.getByText("Which variant?")).toBeInTheDocument();
    expect(screen.getByText("Add-ons?")).toBeInTheDocument();
  });
});
