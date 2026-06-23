// Runtime probe: hits the live backend API and asserts behavior end-to-end.
// Writes .verify/results.json and exits non-zero if any check fails.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:4555";
const WS = process.env.SKILL_SMITH_WORKSPACE_DIR ?? ".verify/workspace";
const checks = [];
const rec = (name, target, ok, detail) => {
  checks.push({ name, target, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    await sleep(150);
  }
  return null;
}

async function main() {
  // 1) readiness
  const health = await poll(async () => {
    const r = await fetch(`${BASE}/api/health`);
    return r.ok ? r.json() : null;
  });
  rec("backend boots & /api/health", "GET /api/health", !!health && health.ok === true, health ? `model=${health.model}` : "no response");
  if (!health) return finish();

  // 2) say-hi round-trip
  const sayHi = await (await fetch(`${BASE}/api/say-hi`, { method: "POST" })).json();
  const hiJob = await poll(async () => {
    const j = await (await fetch(`${BASE}/api/jobs/${sayHi.id}`)).json();
    return j.status === "done" ? j : null;
  });
  rec("say-hi round-trip completes", "POST /api/say-hi", !!hiJob && hiJob.meter.calls >= 1,
    hiJob ? `status=done calls=${hiJob.meter.calls} cost=$${hiJob.meter.totalCostUsd}` : "did not finish");

  // 3) SSE stream emits events for the say-hi job
  const sse = await fetch(`${BASE}/api/jobs/${sayHi.id}/stream`);
  const reader = sse.body.getReader();
  const { value } = await reader.read();
  const frame = new TextDecoder().decode(value ?? new Uint8Array());
  await reader.cancel();
  rec("SSE stream replays events", "GET /api/jobs/:id/stream", frame.includes("event:"), `first frame had ${frame.includes("event:") ? "an event:" : "no event"} line`);

  // 4) Stage 0 intake -> awaiting_input with <=5 questions
  const created = await (await fetch(`${BASE}/api/jobs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "AEM project with React" }),
  })).json();
  const scoped = await poll(async () => {
    const j = await (await fetch(`${BASE}/api/jobs/${created.id}`)).json();
    return j.status === "awaiting_input" ? j : null;
  });
  rec("Stage 0 scoping parks awaiting input", "POST /api/jobs", !!scoped && Array.isArray(scoped.questions) && scoped.questions.length > 0 && scoped.questions.length <= 5,
    scoped ? `questions=${scoped.questions.length}` : "did not reach awaiting_input");

  // 5) use-defaults -> scope.json written, stage done
  const ans = await fetch(`${BASE}/api/jobs/${created.id}/answers`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ useDefaults: true }),
  });
  const ansBody = await ans.json();
  const scopePath = path.join(WS, created.id, "scope.json");
  const scopeOnDisk = fs.existsSync(scopePath);
  rec("answers/use-defaults writes scope.json", "POST /api/jobs/:id/answers",
    ans.status === 200 && ansBody.scope?.usedDefaults === true && scopeOnDisk,
    `status=${ans.status} usedDefaults=${ansBody.scope?.usedDefaults} scope.json=${scopeOnDisk}`);

  // 6) refresh re-attach: re-GET returns persisted job with scope done
  const refetched = await (await fetch(`${BASE}/api/jobs/${created.id}`)).json();
  const scopeStage = refetched.stages?.find((s) => s.key === "scope");
  rec("refresh re-attaches from disk", "GET /api/jobs/:id (reload)",
    refetched.description === "AEM project with React" && scopeStage?.status === "done",
    `desc persisted=${refetched.description === "AEM project with React"} scopeStage=${scopeStage?.status}`);

  // 7) Stages 1-5 still pending this phase
  const laterPending = refetched.stages.filter((s) => s.key !== "scope").every((s) => s.status === "pending");
  rec("Stages 2-6 remain pending", "job.stages", laterPending, `nonScopeAllPending=${laterPending}`);

  // 8) error cases
  const noDesc = await fetch(`${BASE}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  rec("empty description -> 400", "POST /api/jobs {}", noDesc.status === 400, `status=${noDesc.status}`);
  const missing = await fetch(`${BASE}/api/jobs/does-not-exist`);
  rec("missing job -> 404", "GET /api/jobs/does-not-exist", missing.status === 404, `status=${missing.status}`);
  const budget = await (await fetch(`${BASE}/api/budget`)).json();
  rec("budget snapshot endpoint", "GET /api/budget", typeof budget.count === "number", `count=${budget.count} ceiling=${budget.ceiling}`);

  finish();
}

function finish() {
  fs.writeFileSync(".verify/results.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((c) => c.result === "FAIL").length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { rec("probe crashed", "probe", false, String(e)); finish(); });
