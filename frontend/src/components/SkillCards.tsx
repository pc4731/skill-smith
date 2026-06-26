import type { GenerationState, SkillGenStatus } from "../types.js";

const ICON: Record<SkillGenStatus, string> = { pending: "○", running: "◐", done: "✓", failed: "✕" };
const LABEL: Record<SkillGenStatus, string> = {
  pending: "Pending",
  running: "Generating…",
  done: "Done",
  failed: "Failed",
};

/** Stage-3 per-skill generation cards with the deterministic validation result. */
export function SkillCards({
  generation,
  busy = false,
  onRetry,
}: {
  generation: GenerationState | undefined;
  busy?: boolean;
  /** Re-generate only failed skills (resume). When omitted, the button is hidden. */
  onRetry?: () => void;
}) {
  if (!generation || generation.skills.length === 0) return null;

  const failedCount = generation.skills.filter((s) => s.status === "failed").length;
  const isRunning = generation.status === "running";
  // Offer a retry only once generation has settled and something actually failed.
  const canRetry = Boolean(onRetry) && failedCount > 0 && !isRunning;

  return (
    <section className="skills" aria-label="Generated skills">
      <h2 className="skills-title">
        Generated skills
        {generation.status === "done_with_warnings" && (
          <span className="skills-warn"> — some skills failed validation</span>
        )}
        {canRetry && (
          <button
            type="button"
            className="rc-retry"
            onClick={onRetry}
            disabled={busy}
            aria-label={`Retry ${failedCount} failed skill${failedCount === 1 ? "" : "s"}`}
          >
            {busy ? "Retrying…" : `Retry ${failedCount} failed`}
          </button>
        )}
      </h2>
      <div className="skill-cards" aria-live="polite">
        {generation.skills.map((s) => (
          <article key={s.slug} className={`skill-card sc-${s.status}`} data-status={s.status}>
            <header className="sc-head">
              <span className="sc-icon" aria-hidden="true">{ICON[s.status]}</span>
              <span className="sc-name">{s.name}</span>
              <span className="sc-status">{LABEL[s.status]}</span>
            </header>
            {s.reusedFrom && (
              <p className="sc-reused" title={`Seeded from ${s.reusedFrom.slug}`}>
                ♻ adapted from <strong>{s.reusedFrom.name}</strong>
              </p>
            )}
            {s.status === "done" && s.validation && (
              <dl className="sc-validation">
                <div><dt>Description</dt><dd>{s.validation.descriptionChars} chars</dd></div>
                <div><dt>Body</dt><dd>{s.validation.bodyLines} lines</dd></div>
                <div><dt>References</dt><dd>{s.validation.hasReferences ? "yes" : "no"}</dd></div>
              </dl>
            )}
            {s.status === "failed" && (
              <p className="sc-error">{s.error ?? s.validation?.issues.join("; ") ?? "generation failed"}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
