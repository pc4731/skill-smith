// Stage 4 runtime probe: drive a job all the way through self-test and assert report.json + status.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:4558";
const WS = process.env.SKILL_SMITH_WORKSPACE_DIR ?? ".verify/workspace-s4";
const checks = [];
const rec = (name, target, ok, detail) => {
  checks.push({ name, target, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 25000) {
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

  const id = (await (await fetch(`${BASE}/api/jobs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "Spring Boot REST + SOAP + SQL" }),
  })).json()).id;

  await poll(async () => (await getJob(id)).status === "awaiting_input" ? true : null);
  await fetch(`${BASE}/api/jobs/${id}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ useDefaults: true }) });

  const designed = await poll(async () => { const j = await getJob(id); return j.design?.status === "awaiting_approval" ? j : null; });
  rec("reached design approval gate", "job.design.status", !!designed, designed ? `skills=${designed.design.skills.length}` : "no plan");
  if (!designed) return finish();

  await fetch(`${BASE}/api/jobs/${id}/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approve: true }) });

  // generation -> self-test auto-advance
  const tested = await poll(async () => {
    const j = await getJob(id);
    return j.selftest && (j.selftest.status === "done" || j.selftest.status === "done_with_warnings") ? j : null;
  }, 40000);
  rec("Stage 4 self-test completes", "job.selftest.status", !!tested,
    tested ? `status=${tested.selftest.status} skills=${tested.selftest.skills.length}` : "self-test did not finish");

  if (tested) {
    rec("Test stepper step done", "job.stages", tested.stages.find((s) => s.key === "test")?.status === "done",
      `test stage=${tested.stages.find((s) => s.key === "test")?.status}`);

    let ok = true, detail = [];
    for (const s of tested.selftest.skills) {
      const f = path.join(WS, id, "skills", s.slug, "report.json");
      const exists = fs.existsSync(f);
      let valid = false;
      if (exists) {
        const r = JSON.parse(fs.readFileSync(f, "utf8"));
        valid = typeof r.triggerRate === "number" && typeof r.capabilityScore === "number" && typeof r.passed === "boolean";
      }
      ok = ok && exists && valid;
      detail.push(`${s.slug}:passed=${s.passed} trig=${s.triggerRate} ${exists ? (valid ? "report-ok" : "report-bad") : "no-report"}`);
    }
    rec("report.json written per skill with metrics", "skills/<slug>/report.json", ok, detail.join(" "));
    rec("skills passed self-test", "selftest.skills.passed", tested.selftest.skills.every((s) => s.passed === true),
      tested.selftest.skills.map((s) => s.passed).join(","));
  }

  finish();
}

function finish() {
  fs.writeFileSync(".verify/results-stage4.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((c) => c.result === "FAIL").length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { rec("probe crashed", "probe", false, String(e)); finish(); });
