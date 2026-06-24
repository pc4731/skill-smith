import { useState } from "react";
import type { ResultsState, ResultSkill } from "../types.js";

function pct(n: number | undefined): string {
  return n === undefined ? "–" : `${Math.round(n * 100)}%`;
}

function SkillResult({ jobId, skill }: { jobId: string; skill: ResultSkill }) {
  const [preview, setPreview] = useState<string | null>(null);
  const loadPreview = async (open: boolean) => {
    if (open && preview === null) {
      try {
        const res = await fetch(`/api/jobs/${jobId}/skills/${skill.slug}/SKILL.md`);
        setPreview(res.ok ? await res.text() : "(could not load SKILL.md)");
      } catch {
        setPreview("(could not load SKILL.md)");
      }
    }
  };

  return (
    <article className={`result-card rv-${skill.passed ? "pass" : "fail"}`} data-passed={skill.passed}>
      <header className="rv-head">
        <span className="rv-icon" aria-hidden="true">{skill.passed ? "✓" : "✕"}</span>
        <span className="rv-name">{skill.name}</span>
        <span className="rv-badge">{skill.passed ? "Passed" : skill.error ? "Failed" : "Delivered"}</span>
      </header>

      <dl className="rv-metrics">
        <div><dt>Trigger</dt><dd>{pct(skill.triggerRate)}</dd></div>
        <div><dt>Capability</dt><dd>{skill.capabilityScore !== undefined ? skill.capabilityScore.toFixed(2) : "–"}</dd></div>
      </dl>

      {skill.error && <p className="rv-error">{skill.error}</p>}

      {skill.sources.length > 0 && (
        <details className="rv-sources">
          <summary>Sources ({skill.sources.length})</summary>
          <ul>
            {skill.sources.map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a></li>
            ))}
          </ul>
        </details>
      )}

      <details className="rv-preview" onToggle={(e) => loadPreview((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>SKILL.md preview</summary>
        <pre className="rv-md">{preview ?? "Loading…"}</pre>
      </details>

      <div className="rv-install">
        <div><span className="rv-hint-label">Personal:</span> <code>{skill.installHints.personal}</code></div>
        <div><span className="rv-hint-label">Project:</span> <code>{skill.installHints.project}</code></div>
      </div>

      {skill.packageRelPath && (
        <a className="btn btn-primary rv-download" href={`/api/jobs/${jobId}/skills/${skill.slug}/package`} download>
          Download .skill
        </a>
      )}
    </article>
  );
}

export function ResultsView({ jobId, results }: { jobId: string; results: ResultsState | undefined }) {
  if (!results || results.skills.length === 0) return null;
  return (
    <section className="results" aria-label="Generated skills (results)">
      <div className="results-header">
        <h2 className="results-title">
          Results
          {results.status === "done_with_warnings" && <span className="results-warn"> — some skills failed packaging</span>}
        </h2>
        {results.packageAllRelPath && (
          <a className="btn btn-ghost" href={`/api/jobs/${jobId}/download-all`} download>Download all</a>
        )}
      </div>
      <div className="result-cards" aria-live="polite">
        {results.skills.map((s) => (
          <SkillResult key={s.slug} jobId={jobId} skill={s} />
        ))}
      </div>
    </section>
  );
}
