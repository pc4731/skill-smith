import { afterEach, describe, expect, it } from "vitest";
import { ClaudeClient } from "../src/claude/claudeClient.js";
import { SCOPE_JSON_SCHEMA } from "../src/stages/stage0Scope.js";
import { counterFile, testConfig } from "./helpers.js";

const ENV_KEYS = ["FAKE_CLAUDE_MODE", "FAKE_CLAUDE_COUNTER"];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("ClaudeClient", () => {
  it("streams text and captures cost/usage from the result event", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok";
    const client = new ClaudeClient(testConfig());
    const chunks: string[] = [];
    const res = await client.stream({ prompt: "say hi", onText: (t) => chunks.push(t) });
    expect(chunks.join("")).toBe("hi there");
    expect(res.text).toBe("hi there");
    expect(res.info.totalCostUsd).toBeCloseTo(0.0013, 6);
    expect(res.info.inputTokens).toBe(8);
    expect(res.info.isError).toBe(false);
  });

  it("returns the schema-conforming structured output for json mode", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok";
    const client = new ClaudeClient(testConfig());
    const res = await client.structured<{ targetStack: string; questions: unknown[] }>({
      prompt: "scope this",
      jsonSchema: SCOPE_JSON_SCHEMA,
    });
    expect(res.structuredOutput.targetStack).toBe("Demo stack");
    expect(res.structuredOutput.questions).toHaveLength(3);
    expect(res.info.totalCostUsd).toBeCloseTo(0.0021, 6);
  });

  it("retries a retryable failure with backoff and then succeeds", async () => {
    process.env.FAKE_CLAUDE_MODE = "retry";
    process.env.FAKE_CLAUDE_COUNTER = counterFile();
    const client = new ClaudeClient(testConfig());
    let attempts = 0;
    const res = await client.stream({ prompt: "say hi", onAttempt: () => (attempts += 1) });
    expect(attempts).toBe(1); // failed once, retried once, then succeeded
    expect(res.text).toBe("hi there");
  });

  it("does NOT retry a non-retryable error (invalid_request)", async () => {
    process.env.FAKE_CLAUDE_MODE = "nonretryable";
    const client = new ClaudeClient(testConfig());
    let attempts = 0;
    await expect(
      client.stream({ prompt: "say hi", onAttempt: () => (attempts += 1) }),
    ).rejects.toThrow(/invalid_request/);
    expect(attempts).toBe(0);
  });

  it("gives up after exhausting retries on a hard failure", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail";
    const client = new ClaudeClient(testConfig({ retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 } }));
    let attempts = 0;
    await expect(
      client.stream({ prompt: "say hi", onAttempt: () => (attempts += 1) }),
    ).rejects.toThrow();
    expect(attempts).toBe(2); // 1 initial + 2 retries = 3 spawns, 2 retry notifications
  });
});
