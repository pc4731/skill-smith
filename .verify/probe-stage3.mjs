// Stage 2-3 runtime probe: drive a job scope -> research -> design -> approve -> generation,
// then assert each skill's SKILL.md is written + valid and the stages complete.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:4557";
const WS = process.env.SKILL_SMITH_WORKSPACE_DIR ?? ".verify/workspace-s3";
const checks = [];
const rec = (name, target, ok, detail) => {
  checks.push({ name, target, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 20000) {
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
  await fetch(`${BASE}/api/jobs/${id}/answers`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ useDefaults: true }),
  });

  // research -> design auto-advance, parks awaiting plan approval
  const designed = await poll(async () => {
    const j = await getJob(id);
    return j.design?.status === "awaiting_approval" ? j : null;
  });
  rec("Stage 2 design parks awaiting approval", "job.design.status", !!designed && designed.design.skills.length > 0,
    designed ? `skills=${designed.design.skills.length}` : "no plan");
  if (!designed) return finish();

  // approve the plan -> generation
  const approve = await fetch(`${BASE}/api/jobs/${id}/plan`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approve: true }),
  });
  rec("approve plan endpoint", "POST /api/jobs/:id/plan", approve.status === 202, `status=${approve.status}`);

  const generated = await poll(async () => {
    const j = await getJob(id);
    return j.generation && (j.generation.status === "done" || j.generation.status === "done_with_warnings") ? j : null;
  });
  rec("Stage 3 generation completes", "job.generation.status", !!generated,
    generated ? `status=${generated.generation.status} skills=${generated.generation.skills.length}` : "generation did not finish");

  if (generated) {
    rec("Generate stepper step done", "job.stages", generated.stages.find((s) => s.key === "generate")?.status === "done",
      `generate stage=${generated.stages.find((s) => s.key === "generate")?.status}`);
    rec("Design stepper step done", "job.stages", generated.stages.find((s) => s.key === "design")?.status === "done",
      `design stage=${generated.stages.find((s) => s.key === "design")?.status}`);

    let filesOk = true, detail = [];
    for (const s of generated.generation.skills) {
      const md = path.join(WS, id, "skills", s.slug, "SKILL.md");
      const exists = fs.existsSync(md);
      let valid = false;
      if (exists) {
        const text = fs.readFileSync(md, "utf8");
        valid = /^---[\s\S]*?name:[\s\S]*?description:[\s\S]*?---/.test(text);
      }
      filesOk = filesOk && (s.status === "done" ? exists && valid : true);
      detail.push(`${s.slug}:${s.status}/${exists ? (valid ? "valid" : "invalid") : "missing"}`);
    }
    rec("each done skill has a valid SKILL.md", "skills/<slug>/SKILL.md", filesOk, detail.join(" "));

    // plan.json persisted
    rec("plan.json persisted", "workspace/<job>/plan.json", fs.existsSync(path.join(WS, id, "plan.json")), "");
  }

  // error case: approving again is a 409 (no plan awaiting / generation already past)
  const reAppr = await fetch(`${BASE}/api/jobs/${id}/plan`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approve: true }),
  });
  rec("re-approve guarded", "POST /api/jobs/:id/plan (again)", reAppr.status === 409, `status=${reAppr.status}`);

  finish();
}

function finish() {
  fs.writeFileSync(".verify/results-stage3.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((c) => c.result === "FAIL").length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { rec("probe crashed", "probe", false, String(e)); finish(); });
