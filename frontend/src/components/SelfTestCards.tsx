import type { SelfTestSkillStatus, SelfTestState } from "../types.js";

const ICON: Record<SelfTestSkillStatus, string> = { pending: "○", running: "◐", done: "✓", failed: "✕" };
const LABEL: Record<SelfTestSkillStatus, string> = {
  pending: "Pending",
  running: "Self-testing…",
  done: "Passed",
  failed: "Failed",
};

function pct(n: number | undefined): string {
  return n === undefined ? "–" : `${Math.round(n * 100)}%`;
}

/** Stage-4 per-skill self-test report cards (trigger rate + capability score + pass/fail). */
export function SelfTestCards({ selftest }: { selftest: SelfTestState | undefined }) {
  if (!selftest || selftest.skills.length === 0) return null;
  return (
    <section className="selftest" aria-label="Self-test reports">
      <h2 className="selftest-title">
        Self-test
        {selftest.status === "done_with_warnings" && (
          <span className="selftest-warn"> — some skills failed self-test</span>
        )}
      </h2>
      <div className="selftest-cards" aria-live="polite">
        {selftest.skills.map((s) => (
          <article key={s.slug} className={`selftest-card stc-${s.status}`} data-status={s.status}>
            <header className="stc-head">
              <span className="stc-icon" aria-hidden="true">{ICON[s.status]}</span>
              <span className="stc-name">{s.name}</span>
              <span className="stc-status">{LABEL[s.status]}</span>
            </header>
            {(s.status === "done" || s.status === "failed") && s.triggerRate !== undefined && (
              <dl className="stc-metrics">
                <div><dt>Trigger</dt><dd>{pct(s.triggerRate)}</dd></div>
                <div><dt>False-trigger</dt><dd>{pct(s.falseTriggerRate)}</dd></div>
                <div><dt>Capability</dt><dd>{s.capabilityScore !== undefined ? s.capabilityScore.toFixed(2) : "–"}</dd></div>
              </dl>
            )}
            {s.status === "failed" && s.error && <p className="stc-error">{s.error}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
