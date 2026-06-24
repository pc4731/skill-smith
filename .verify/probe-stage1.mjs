// Stage 1 runtime probe: drive a job from Stage 0 (use defaults) into Stage 1 research,
// assert research/<domain>.json briefs are written and the research stage completes.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:4556";
const WS = process.env.SKILL_SMITH_WORKSPACE_DIR ?? ".verify/workspace-s1";
const checks = [];
const rec = (name, target, ok, detail) => {
  checks.push({ name, target, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(150);
  }
  return null;
}

async function main() {
  const health = await poll(async () => {
    const r = await fetch(`${BASE}/api/health`);
    return r.ok ? r.json() : null;
  });
  rec("backend boots", "GET /api/health", !!health?.ok, health ? `model=${health.model}` : "no response");
  if (!health) return finish();

  const created = await (await fetch(`${BASE}/api/jobs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "AEM project with React" }),
  })).json();
  const id = created.id;

  const scoped = await poll(async () => {
    const j = await (await fetch(`${BASE}/api/jobs/${id}`)).json();
    return j.status === "awaiting_input" ? j : null;
  });
  rec("Stage 0 awaiting input", "POST /api/jobs", !!scoped, scoped ? `questions=${scoped.questions?.length}` : "no awaiting_input");

  // Use defaults -> should auto-advance into Stage 1 research.
  await fetch(`${BASE}/api/jobs/${id}/answers`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ useDefaults: true }),
  });

  const researched = await poll(async () => {
    const j = await (await fetch(`${BASE}/api/jobs/${id}`)).json();
    return j.research && (j.research.status === "done" || j.research.status === "done_with_warnings") ? j : null;
  });
  rec("Stage 1 research completes", "job.research.status", !!researched,
    researched ? `status=${researched.research.status} domains=${researched.research.domains.length}` : "research did not finish");

  if (researched) {
    const allDone = researched.research.domains.every((d) => d.status === "done");
    rec("all domains done", "research.domains", allDone, `domains=${researched.research.domains.map((d) => d.status).join(",")}`);

    const researchStage = researched.stages.find((s) => s.key === "research");
    rec("Research stepper step done", "job.stages", researchStage?.status === "done", `research stage=${researchStage?.status}`);

    // Each domain has a valid brief file with >=2 sources.
    let filesOk = true, detail = [];
    for (const d of researched.research.domains) {
      const f = path.join(WS, id, "research", `${d.slug}.json`);
      const exists = fs.existsSync(f);
      let valid = false;
      if (exists) {
        const b = JSON.parse(fs.readFileSync(f, "utf8"));
        valid = Array.isArray(b.sources) && b.sources.length >= 2 && typeof b.version_notes === "string" && b.version_notes.length > 0;
      }
      filesOk = filesOk && exists && valid;
      detail.push(`${d.slug}:${exists ? (valid ? "ok" : "invalid") : "missing"}`);
    }
    rec("brief files written + valid", "research/<slug>.json", filesOk, detail.join(" "));

    rec("meter counted research calls", "job.meter.calls", researched.meter.calls >= researched.research.domains.length,
      `calls=${researched.meter.calls} domains=${researched.research.domains.length}`);
  }

  // Re-trigger endpoint guard (research already done -> should accept 202 or 409 if running; never 5xx).
  const retrig = await fetch(`${BASE}/api/jobs/${id}/research`, { method: "POST" });
  rec("research re-trigger endpoint", "POST /api/jobs/:id/research", retrig.status === 202 || retrig.status === 409, `status=${retrig.status}`);

  finish();
}

function finish() {
  fs.writeFileSync(".verify/results-stage1.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((c) => c.result === "FAIL").length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { rec("probe crashed", "probe", false, String(e)); finish(); });
