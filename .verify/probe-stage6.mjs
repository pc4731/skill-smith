// Phase 6 runtime probe: history list, re-run, and restart reconciliation.
import fs from "node:fs";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:4561";
const checks = [];
const rec = (name, target, ok, detail) => {
  checks.push({ name, target, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(150);
  }
  return null;
}
const getJob = async (id) => (await fetch(`${BASE}/api/jobs/${id}`)).json();

async function main() {
  const health = await poll(async () => { const r = await fetch(`${BASE}/api/health`); return r.ok ? r.json() : null; });
  rec("backend boots", "GET /api/health", !!health?.ok, health ? `model=${health.model}` : "no response");
  if (!health) return finish();

  // (1) Drive a job to completion + confirm it's listed.
  const id = (await (await fetch(`${BASE}/api/jobs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "Spring Boot REST + SOAP + SQL" }),
  })).json()).id;
  await poll(async () => (await getJob(id)).status === "awaiting_input" ? true : null);
  await fetch(`${BASE}/api/jobs/${id}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ useDefaults: true }) });
  await poll(async () => { const j = await getJob(id); return j.design?.status === "awaiting_approval" ? true : null; });
  await fetch(`${BASE}/api/jobs/${id}/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approve: true }) });
  const done = await poll(async () => { const j = await getJob(id); return j.status === "done" ? j : null; }, 60000);
  rec("job runs to completion", "job.status", !!done, done ? `status=done meterCalls=${done.meter.calls}` : "did not finish");
  rec("meter updated", "job.meter", !!done && done.meter.calls > 0 && done.meter.totalCostUsd >= 0, done ? `calls=${done.meter.calls} cost=${done.meter.totalCostUsd}` : "n/a");

  const list = await (await fetch(`${BASE}/api/jobs`)).json();
  const row = list.find((j) => j.id === id);
  rec("GET /api/jobs lists the job (summary)", "GET /api/jobs", !!row && row.skillCount >= 0 && !("research" in row), row ? `status=${row.status} skills=${row.skillCount}` : "not listed");

  // (2) Re-run -> a new distinct job.
  const rerun = await fetch(`${BASE}/api/jobs/${id}/rerun`, { method: "POST" });
  const newId = (await rerun.json()).id;
  rec("rerun starts a new distinct job", "POST /rerun", rerun.status === 202 && newId && newId !== id, `status=${rerun.status} newId=${newId !== id}`);
  const newJob = await poll(async () => { const j = await getJob(newId); return j ? j : null; });
  rec("rerun preserves the description", "clone.description", newJob?.description === "Spring Boot REST + SOAP + SQL", newJob?.description ?? "missing");

  finish();
}

function finish() {
  fs.writeFileSync(".verify/results-stage6.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((c) => c.result === "FAIL").length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { rec("probe crashed", "probe", false, String(e)); finish(); });
