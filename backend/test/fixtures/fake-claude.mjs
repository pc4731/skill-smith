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
import path from "node:path";

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
  // Test hook: force a per-domain research failure when the prompt names FAIL_DOMAIN.
  const prompt = flagValue("-p") || "";
  if (prompt.includes("FAIL_DOMAIN")) {
    process.stderr.write("forced domain failure\n");
    process.exit(1);
  }
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
    const schemaArg = flagValue("--json-schema") || "";
    const jp = flagValue("-p") || "";
    const isDesign = schemaArg.includes("scopeBoundaries") || schemaArg.includes("sourceDomains");
    const isResearch = schemaArg.includes("key_apis") || schemaArg.includes("version_notes");
    const isTriggerPrompts = schemaArg.includes("shouldTrigger");
    const isJudge = schemaArg.includes('"skill"') && !schemaArg.includes("skills");
    const isGrade = schemaArg.includes('"score"') && schemaArg.includes('"passed"');
    const isDescRewrite = schemaArg.includes('"description"') && !isDesign && !isResearch;
    if (isTriggerPrompts) {
      const m = jp.match(/named "([^"]+)"/);
      const nm = m ? m[1] : "skill";
      out.structured_output = {
        shouldTrigger: [`use ${nm} to do X`, `build with ${nm}`, `${nm} task A`, `${nm} task B`],
        shouldNot: ["what's the weather today"],
      };
    } else if (isJudge) {
      const exp = (jp.match(/EVAL_EXPECT=([^\s]+)/) || [])[1] || "none";
      let answer = exp;
      // Simulate under-trigger for a 'lowtrig' skill until its description is rewritten ("PUSHY-REWRITTEN").
      if (exp !== "none" && exp.includes("lowtrig") && !jp.includes("PUSHY-REWRITTEN")) answer = "none";
      out.structured_output = { skill: answer };
    } else if (isGrade) {
      const fail = jp.includes("lowcap"); // 'lowcap' slug forces a failing capability grade (avoids the 'fail' SKILLGEN hook)
      out.structured_output = fail
        ? { score: 0.2, passed: false, issues: ["used a wrong API; pitfall not avoided"] }
        : { score: 0.9, passed: true, issues: [] };
    } else if (isDescRewrite) {
      const slug = (jp.match(/DESC_SLUG=([a-z0-9-]+)/) || [])[1] || "skill";
      out.structured_output = {
        description: `Use this skill PUSHY-REWRITTEN whenever you work with ${slug}; trigger on its APIs, components, commands, and related tasks.`,
      };
    } else if (isDesign) {
      // Stage-2 skill-set plan (one-domain-per-skill, pushy descriptions).
      out.structured_output = {
        skills: [
          {
            name: "demo-skill-a",
            description: "Use this skill whenever working with demo-domain-a — covers its APIs, idioms, and gotchas. Trigger on mentions of demo-domain-a, its components, or related tasks.",
            scopeBoundaries: "Covers demo-domain-a only; not demo-domain-b.",
            sourceDomains: ["demo-domain-a"],
          },
          {
            name: "demo-skill-b",
            description: "Use this skill whenever working with demo-domain-b — covers its APIs, idioms, and gotchas. Trigger on mentions of demo-domain-b or related tasks.",
            scopeBoundaries: "Covers demo-domain-b only; not demo-domain-a.",
            sourceDomains: ["demo-domain-b"],
          },
        ],
      };
    } else if (isResearch) {
      // Stage-1 research brief (valid against RESEARCH_JSON_SCHEMA, >= 2 sources).
      out.structured_output = {
        domain: "demo-domain",
        key_apis: ["DemoApi.create()", "DemoApi.render()"],
        idioms: ["prefer composition over inheritance"],
        gotchas: ["watch out for version 2 breaking changes"],
        version_notes: "v2.3 is current; v1 APIs removed in v2",
        sources: [
          { title: "Official docs", url: "https://example.com/docs" },
          { title: "Release notes", url: "https://example.com/releases" },
        ],
      };
    } else {
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

// Stage-3 generation: write a real skill directory into the current working dir
// (the wrapper spawns the CLI with cwd = workspace/<job>/skills/<slug>/).
const streamPrompt = flagValue("-p") || "";
if (streamPrompt.includes("[[SKILLGEN]]")) {
  const m = streamPrompt.match(/SKILL_SLUG=([a-z0-9-]+)/);
  const sk = m ? m[1] : "skill";
  // A slug containing "fail" simulates a generation that produces no SKILL.md.
  if (!sk.includes("fail")) {
    const skillMd = [
      "---",
      `name: ${sk}`,
      `description: Use this skill whenever working with ${sk}; it covers the canonical APIs, idioms, and gotchas. Trigger on mentions of ${sk}, its tools, or related tasks.`,
      "---",
      "",
      `# ${sk}`,
      "",
      `Concise, imperative guidance for ${sk}. See references/overview.md for the heavy detail.`,
      "",
    ].join("\n");
    fs.writeFileSync("SKILL.md", skillMd);
    fs.mkdirSync("references", { recursive: true });
    fs.writeFileSync(path.join("references", "overview.md"), `# ${sk} reference\n\nDetailed APIs and version notes for ${sk}.\n`);
  }
  emit({ type: "system", subtype: "init", session_id: "sess-gen", model: "claude-opus-4-8" });
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `wrote ${sk}` } } });
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "sess-gen",
    total_cost_usd: 0.004,
    usage: { input_tokens: 20, output_tokens: 10 },
  });
  process.exit(0);
}

// Stage-4 capability task: produce some output for the grader (writes nothing destructive).
if (streamPrompt.includes("[[CAPABILITY]]")) {
  const sk = (streamPrompt.match(/SKILL_SLUG=([a-z0-9-]+)/) || [])[1] || "skill";
  emit({ type: "system", subtype: "init", session_id: "sess-cap", model: "claude-opus-4-8" });
  emit({ type: "stream_event", event: { delta: { type: "text_delta", text: `Completed a representative task for ${sk} using the documented APIs.` } } });
  emit({ type: "result", subtype: "success", is_error: false, session_id: "sess-cap", total_cost_usd: 0.005, usage: { input_tokens: 30, output_tokens: 15 } });
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
