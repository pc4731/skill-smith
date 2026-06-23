import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { Job } from "../types.js";

export function HistoryScreen() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listJobs().then(setJobs).catch((e) => setError(String(e.message ?? e)));
  }, []);

  return (
    <main className="history">
      <h1>History</h1>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {jobs === null && !error && <p className="muted">Loading…</p>}
      {jobs && jobs.length === 0 && <p className="muted">No jobs yet. Start one from the home page.</p>}
      {jobs && jobs.length > 0 && (
        <ul className="history-list">
          {jobs.map((j) => (
            <li key={j.id} className="history-item">
              <Link to={`/job/${j.id}`}>
                <span className={`history-status status-${j.status}`}>{j.status}</span>
                <span className="history-desc">{j.description}</span>
                <span className="history-date">{new Date(j.createdAt).toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
