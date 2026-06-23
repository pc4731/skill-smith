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

export function ResearchCards({ research }: { research: ResearchState | undefined }) {
  if (!research || research.domains.length === 0) return null;

  return (
    <section className="research" aria-label="Per-domain research">
      <h2 className="research-title">
        Research
        {research.status === "done_with_warnings" && (
          <span className="research-warn"> — some domains failed</span>
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
              </dl>
            )}
            {d.status === "failed" && d.error && <p className="rc-error">{d.error}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
