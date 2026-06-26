import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { LibrarySkill } from "../types.js";

export function SkillLibraryScreen() {
  const [skills, setSkills] = useState<LibrarySkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.listSkills().then(setSkills).catch((e) => setError(String(e.message ?? e)));
  }, []);

  const filtered = useMemo(() => {
    if (!skills) return [];
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.jobDescription.toLowerCase().includes(q),
    );
  }, [skills, query]);

  return (
    <main className="library">
      <h1>Skill Library</h1>
      <p className="muted">Every skill generated across all runs. Reuse one as a starting point by enabling “Reuse related existing skills” on a new run.</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {skills === null && !error && <p className="muted">Loading…</p>}
      {skills && skills.length === 0 && (
        <p className="muted">No skills generated yet. <Link to="/">Start a run</Link>.</p>
      )}
      {skills && skills.length > 0 && (
        <>
          <input
            type="search"
            className="library-search"
            placeholder="Filter skills…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter skills"
          />
          <ul className="library-list">
            {filtered.map((s) => (
              <li key={`${s.jobId}/${s.slug}`} className="library-item">
                <div className="library-head">
                  <span className="library-name">{s.name}</span>
                  <a
                    className="library-download"
                    href={`/api/jobs/${s.jobId}/skills/${s.slug}/SKILL.md`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    SKILL.md
                  </a>
                </div>
                <p className="library-desc">{s.description}</p>
                <div className="library-meta">
                  <Link to={`/job/${s.jobId}`}>{s.jobDescription}</Link>
                  <span className="library-date">{new Date(s.createdAt).toLocaleString()}</span>
                </div>
              </li>
            ))}
            {filtered.length === 0 && <li className="muted">No skills match “{query}”.</li>}
          </ul>
        </>
      )}
    </main>
  );
}
