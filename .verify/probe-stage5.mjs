// Stage 5 runtime probe: drive a job through to packaging and assert .skill + results + downloads.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:4559";
const WS = process.env.SKILL_SMITH_WORKSPACE_DIR ?? ".verify/workspace-s5";
const checks = [];
const rec = (name, target, ok, detail) => {
  checks.push({ name, target, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 40000) {
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

  await poll(async () => { const j = await getJob(id); return j.design?.status === "awaiting_approval" ? j : null; });
  await fetch(`${BASE}/api/jobs/${id}/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approve: true }) });

  const done = await poll(async () => {
    const j = await getJob(id);
    return j.results && (j.results.status === "done" || j.results.status === "done_with_warnings") ? j : null;
  }, 60000);
  rec("Stage 5 packaging completes", "job.results.status", !!done,
    done ? `status=${done.results.status} skills=${done.results.skills.length}` : "packaging did not finish");
  if (!done) return finish();

  rec("Package stepper step done", "job.stages", done.stages.find((s) => s.key === "package")?.status === "done",
    `package stage=${done.stages.find((s) => s.key === "package")?.status}`);

  // .skill files + results.json on disk
  let diskOk = true, diskDetail = [];
  for (const s of done.results.skills.filter((x) => x.packageRelPath)) {
    const f = path.join(WS, id, "skills", `${s.slug}.skill`);
    const exists = fs.existsSync(f);
    diskOk = diskOk && exists;
    diskDetail.push(`${s.slug}:${exists ? "skill" : "MISSING"}`);
  }
  rec(".skill files written per skill", "skills/<slug>.skill", diskOk, diskDetail.join(" "));
  rec("results.json written", "results.json", fs.existsSync(path.join(WS, id, "results.json")), "on disk");

  const slug = done.results.skills.find((s) => s.packageRelPath)?.slug;
  if (slug) {
    const md = await fetch(`${BASE}/api/jobs/${id}/skills/${slug}/SKILL.md`);
    const mdText = await md.text();
    rec("GET SKILL.md returns skill text", "/skills/:slug/SKILL.md", md.status === 200 && /name:/.test(mdText), `status=${md.status}`);

    const pkg = await fetch(`${BASE}/api/jobs/${id}/skills/${slug}/package`);
    const pkgBuf = Buffer.from(await pkg.arrayBuffer());
    rec("GET package returns a zip", "/skills/:slug/package", pkg.status === 200 && pkgBuf.slice(0, 2).toString("latin1") === "PK", `status=${pkg.status} bytes=${pkgBuf.length}`);

    const all = await fetch(`${BASE}/api/jobs/${id}/download-all`);
    const allBuf = Buffer.from(await all.arrayBuffer());
    rec("GET download-all returns a zip", "/download-all", all.status === 200 && allBuf.slice(0, 2).toString("latin1") === "PK", `status=${all.status} bytes=${allBuf.length}`);

    const missing = await fetch(`${BASE}/api/jobs/${id}/skills/does-not-exist/package`);
    rec("missing package 404s", "/skills/nope/package", missing.status === 404, `status=${missing.status}`);
  }

  finish();
}

function finish() {
  fs.writeFileSync(".verify/results-stage5.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((c) => c.result === "FAIL").length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { rec("probe crashed", "probe", false, String(e)); finish(); });
