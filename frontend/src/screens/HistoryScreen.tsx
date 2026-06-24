import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import type { JobStatus, JobSummary } from "../types.js";

const STATUS_LABEL: Record<JobStatus, string> = {
  active: "Running",
  awaiting_input: "Awaiting input",
  done: "Done",
  failed: "Failed",
};
const STATUS_ICON: Record<JobStatus, string> = {
  active: "◐",
  awaiting_input: "?",
  done: "✓",
  failed: "✕",
};

export function HistoryScreen() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.listJobs().then(setJobs).catch((e) => setError(String(e.message ?? e)));
  }, []);

  async function rerun(id: string) {
    setRerunning(id);
    try {
      const { id: newId } = await api.rerunJob(id);
      navigate(`/job/${newId}`);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setRerunning(null);
    }
  }

  return (
    <main className="history">
      <h1>History</h1>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {jobs === null && !error && <p className="muted">Loading…</p>}
      {jobs && jobs.length === 0 && (
        <p className="muted">No jobs yet. <Link to="/">Start one</Link> from the home page.</p>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="history-list">
          {jobs.map((j) => (
            <li key={j.id} className={`history-item hist-${j.status}`}>
              <Link to={`/job/${j.id}`} className="history-main">
                <span className={`history-status status-${j.status}`}>
                  <span aria-hidden="true">{STATUS_ICON[j.status]}</span> {STATUS_LABEL[j.status]}
                </span>
                <span className="history-desc">{j.description}</span>
                <span className="history-meta">
                  {j.skillCount > 0 && <span>{j.skillCount} skill{j.skillCount === 1 ? "" : "s"}</span>}
                  <span>${j.cost.toFixed(4)}</span>
                  <span className="history-date">{new Date(j.createdAt).toLocaleString()}</span>
                </span>
              </Link>
              <button
                type="button"
                className="btn btn-ghost history-rerun"
                onClick={() => rerun(j.id)}
                disabled={rerunning === j.id}
              >
                {rerunning === j.id ? "Re-running…" : "Re-run"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
