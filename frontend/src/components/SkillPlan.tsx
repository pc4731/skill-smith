import type { DesignState } from "../types.js";

interface Props {
  design: DesignState;
  busy?: boolean;
  onApprove: () => void;
}

/** Stage-2 approve gate: shows the proposed skill set and lets the user approve it. */
export function SkillPlan({ design, busy, onApprove }: Props) {
  return (
    <section className="skill-plan" aria-label="Proposed skill set">
      <h2 className="skill-plan-title">Proposed skill set</h2>
      <p className="muted">Review the skills Skill Smith will generate, then approve to start generation.</p>
      <ul className="plan-list">
        {design.skills.map((s) => (
          <li key={s.slug} className="plan-item">
            <div className="plan-name">{s.name}</div>
            <p className="plan-desc">{s.description}</p>
            <div className="plan-meta">
              <span className="plan-scope">{s.scopeBoundaries}</span>
              {s.sourceDomains.length > 0 && (
                <span className="plan-domains">domains: {s.sourceDomains.join(", ")}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="plan-actions">
        <button type="button" className="btn btn-primary" onClick={onApprove} disabled={busy}>
          Approve &amp; generate {design.skills.length} skill{design.skills.length === 1 ? "" : "s"}
        </button>
      </div>
    </section>
  );
}
