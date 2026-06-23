import { describe, expect, it } from "vitest";
import { StreamParser } from "../src/claude/streamParser.js";

describe("StreamParser", () => {
  it("classifies the canonical event types", () => {
    const p = new StreamParser();
    const events = p.feed(
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
        JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "hi" } } }),
        JSON.stringify({ type: "assistant", message: {} }),
        JSON.stringify({
          type: "result",
          is_error: false,
          total_cost_usd: 0.01,
          usage: { input_tokens: 5, output_tokens: 2 },
          session_id: "s1",
        }),
        "",
      ].join("\n"),
    );
    expect(events.map((e) => e.kind)).toEqual(["system", "stream_event", "assistant", "result"]);
    const result = events.find((e) => e.kind === "result");
    expect(result?.kind === "result" && result.info.totalCostUsd).toBe(0.01);
    expect(result?.kind === "result" && result.info.inputTokens).toBe(5);
  });

  it("buffers events split across chunk boundaries", () => {
    const p = new StreamParser();
    const line = JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "abc" } } });
    const mid = Math.floor(line.length / 2);
    expect(p.feed(line.slice(0, mid))).toHaveLength(0);
    const events = p.feed(line.slice(mid) + "\n");
    expect(events).toHaveLength(1);
    expect(events[0]?.kind === "stream_event" && events[0].textDelta).toBe("abc");
  });

  it("surfaces api_retry events with their fields", () => {
    const p = new StreamParser();
    const events = p.feed(
      JSON.stringify({
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 1000,
        error_status: 529,
        error: "overloaded",
      }) + "\n",
    );
    expect(events[0]?.kind).toBe("api_retry");
    expect(events[0]?.kind === "api_retry" && events[0].info.error).toBe("overloaded");
  });

  it("ignores unknown types and non-JSON noise without throwing", () => {
    const p = new StreamParser();
    const events = p.feed(
      ["not json at all", JSON.stringify({ type: "brand_new_event", foo: 1 }), ""].join("\n"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("unknown");
  });

  it("flush() parses a trailing line with no newline", () => {
    const p = new StreamParser();
    expect(p.feed(JSON.stringify({ type: "assistant" }))).toHaveLength(0);
    expect(p.flush().map((e) => e.kind)).toEqual(["assistant"]);
  });
});
