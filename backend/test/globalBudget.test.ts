import { describe, expect, it } from "vitest";
import { GlobalBudget } from "../src/util/globalBudget.js";

describe("GlobalBudget", () => {
  it("is unlimited when the ceiling is 0", () => {
    const b = new GlobalBudget(0);
    for (let i = 0; i < 100; i++) expect(b.tryConsume()).toBe(true);
    expect(b.snapshot().ceiling).toBe(0);
  });

  it("allows up to the ceiling then refuses", () => {
    const b = new GlobalBudget(2);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
    expect(b.snapshot().count).toBe(2);
  });
});
