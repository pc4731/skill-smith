import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeClient } from "../src/claude/claudeClient.js";
import { loadConfig } from "../src/config/config.js";
import { createApp } from "../src/server.js";
import { GlobalBudget } from "../src/util/globalBudget.js";
import { testConfig } from "./helpers.js";

afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
});

describe("config defaults", () => {
  it("binds localhost by default and sets cost-guardrail defaults", () => {
    const c = loadConfig({ skipFile: true, env: {} });
    expect(c.host).toBe("127.0.0.1");
    expect(c.maxDescriptionLength).toBe(4000);
    expect(c.globalDailyInvocationCeiling).toBe(0); // unlimited unless configured
  });

  it("honors env overrides for the new guardrails", () => {
    const c = loadConfig({
      skipFile: true,
      env: { SKILL_SMITH_HOST: "0.0.0.0", SKILL_SMITH_MAX_DESCRIPTION_LENGTH: "50", SKILL_SMITH_DAILY_INVOCATION_CEILING: "7" },
    });
    expect(c.host).toBe("0.0.0.0");
    expect(c.maxDescriptionLength).toBe(50);
    expect(c.globalDailyInvocationCeiling).toBe(7);
  });
});

describe("API guardrails", () => {
  it("rejects an over-long description with 400", async () => {
    const { app } = createApp({ config: testConfig({ maxDescriptionLength: 10 }), heartbeatMs: 0 });
    const res = await request(app).post("/api/jobs").send({ description: "x".repeat(11) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/);
  });

  it("exposes the daily budget snapshot", async () => {
    const { app } = createApp({ config: testConfig({ globalDailyInvocationCeiling: 5 }), heartbeatMs: 0 });
    const res = await request(app).get("/api/budget");
    expect(res.status).toBe(200);
    expect(res.body.ceiling).toBe(5);
    expect(typeof res.body.count).toBe("number");
  });
});

describe("ClaudeClient daily budget", () => {
  it("refuses a call once the daily budget is exhausted (non-retryable)", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok";
    const budget = new GlobalBudget(1);
    const client = new ClaudeClient(testConfig(), undefined, budget);
    await client.stream({ prompt: "say hi" }); // consumes the only unit
    let attempts = 0;
    await expect(
      client.stream({ prompt: "say hi", onAttempt: () => (attempts += 1) }),
    ).rejects.toThrow(/budget/i);
    expect(attempts).toBe(0); // failed before any spawn/retry
  });
});
