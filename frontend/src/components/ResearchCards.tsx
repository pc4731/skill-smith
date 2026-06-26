import type { ResearchDomainStatus, ResearchState } from "../types.js";

const STATUS_ICON: Record<ResearchDomainStatus, string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✕",
};

const STATUS_LABEL: Record<ResearchDomainStatus, string> = {
  pending: "Pending",
  running: "Researching…",
  done: "Done",
  failed: "Failed",
};

export function ResearchCards({
  research,
  busy = false,
  onRetry,
}: {
  research: ResearchState | undefined;
  busy?: boolean;
  /** Retry only failed domains (resume). When omitted, the button is hidden. */
  onRetry?: () => void;
}) {
  if (!research || research.domains.length === 0) return null;

  const failedCount = research.domains.filter((d) => d.status === "failed").length;
  const isRunning = research.status === "running";
  // Offer a retry only once research has settled and something actually failed.
  const canRetry = Boolean(onRetry) && failedCount > 0 && !isRunning;
  const totalCost = research.domains.reduce((sum, d) => sum + (d.cost ?? 0), 0);

  return (
    <section className="research" aria-label="Per-domain research">
      <h2 className="research-title">
        Research
        {research.status === "done_with_warnings" && (
          <span className="research-warn"> — some domains failed</span>
        )}
        {totalCost > 0 && (
          <span className="research-cost" title="Total research spend">
            {" "}${totalCost.toFixed(4)}
          </span>
        )}
        {canRetry && (
          <button
            type="button"
            className="rc-retry"
            onClick={onRetry}
            disabled={busy}
            aria-label={`Retry ${failedCount} failed domain${failedCount === 1 ? "" : "s"}`}
          >
            {busy ? "Retrying…" : `Retry ${failedCount} failed`}
          </button>
        )}
      </h2>
      <div className="research-cards" aria-live="polite">
        {research.domains.map((d) => (
          <article key={d.domain} className={`research-card rc-${d.status}`} data-status={d.status}>
            <header className="rc-head">
              <span className="rc-icon" aria-hidden="true">{STATUS_ICON[d.status]}</span>
              <span className="rc-domain">{d.domain}</span>
              <span className="rc-status">{STATUS_LABEL[d.status]}</span>
            </header>
            {d.status === "done" && d.summary && (
              <dl className="rc-summary">
                <div><dt>APIs</dt><dd>{d.summary.keyApis}</dd></div>
                <div><dt>Gotchas</dt><dd>{d.summary.gotchas}</dd></div>
                <div><dt>Sources</dt><dd>{d.summary.sources}</dd></div>
                {d.cost !== undefined && <div><dt>Cost</dt><dd>${d.cost.toFixed(4)}</dd></div>}
              </dl>
            )}
            {d.status === "failed" && d.error && <p className="rc-error">{d.error}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
