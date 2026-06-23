#!/usr/bin/env node
/**
 * Deterministic stand-in for the `claude` CLI used by the test suite so nothing
 * hits the paid API. Behaviour is driven by env vars:
 *
 *   FAKE_CLAUDE_MODE = ok | fail | retry | nonretryable   (default: ok)
 *   FAKE_CLAUDE_COUNTER = path to a counter file (for `retry` mode)
 *
 * It emits canned stream-json (for --output-format stream-json) or a single
 * json object (for --output-format json [+ --json-schema]).
 */
import fs from "node:fs";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE || "ok";
const counterFile = process.env.FAKE_CLAUDE_COUNTER;

function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const outputFormat = flagValue("--output-format");
const hasSchema = args.includes("--json-schema");

if (mode === "fail") {
  process.stderr.write("simulated hard failure\n");
  process.exit(1);
}

if (mode === "retry") {
  let n = 0;
  try {
    n = parseInt(fs.readFileSync(counterFile, "utf8"), 10) || 0;
  } catch {
    n = 0;
  }
  n += 1;
  fs.writeFileSync(counterFile, String(n));
  if (n < 2) {
    process.stderr.write("simulated transient failure\n");
    process.exit(1);
  }
  // second attempt: fall through to success
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

if (outputFormat === "json") {
  const out = {
    type: "result",
    subtype: "success",
    result: "hello from fake claude",
    session_id: "sess-json-1",
    total_cost_usd: 0.0021,
    usage: { input_tokens: 12, output_tokens: 6 },
    is_error: false,
  };
  if (hasSchema) {
    out.structured_output = {
      targetStack: "Demo stack",
      domains: ["demo-domain-a", "demo-domain-b"],
      likelyTasks: ["scaffold a component", "write a test"],
      questions: [
        { id: "q1", question: "Which variant?", type: "single", options: ["A", "B"] },
        { id: "q2", question: "Which add-ons?", type: "multi", options: ["x", "y"] },
        { id: "q3", question: "Any constraints?", type: "text" },
      ],
    };
  }
  emit(out);
  process.exit(0);
}

if (mode === "nonretryable") {
  emit({
    type: "result",
    subtype: "error",
    is_error: true,
    error: "invalid_request",
    session_id: "sess-err",
    total_cost_usd: 0,
  });
  process.exit(0);
}

// default: stream-json success
emit({ type: "system", subtype: "init", session_id: "sess-1", model: "claude-opus-4-8" });
emit({ type: "stream_event", event: { delta: { type: "text_delta", text: "hi" } } });
emit({ type: "stream_event", event: { delta: { type: "text_delta", text: " there" } } });
emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi there" }] } });
emit({
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: "sess-1",
  total_cost_usd: 0.0013,
  usage: { input_tokens: 8, output_tokens: 3 },
  num_turns: 1,
  duration_ms: 42,
});
process.exit(0);
