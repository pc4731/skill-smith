import type { GenerationState, SkillGenStatus } from "../types.js";

const ICON: Record<SkillGenStatus, string> = { pending: "○", running: "◐", done: "✓", failed: "✕" };
const LABEL: Record<SkillGenStatus, string> = {
  pending: "Pending",
  running: "Generating…",
  done: "Done",
  failed: "Failed",
};

/** Stage-3 per-skill generation cards with the deterministic validation result. */
export function SkillCards({ generation }: { generation: GenerationState | undefined }) {
  if (!generation || generation.skills.length === 0) return null;
  return (
    <section className="skills" aria-label="Generated skills">
      <h2 className="skills-title">
        Generated skills
        {generation.status === "done_with_warnings" && (
          <span className="skills-warn"> — some skills failed validation</span>
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
