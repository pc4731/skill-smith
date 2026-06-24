import type { Meter } from "../types.js";

export function CostMeter({ meter }: { meter: Meter | undefined }) {
  const m = meter ?? { calls: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, ceiling: 0, ceilingHit: false };
  const tokens = m.inputTokens + m.outputTokens;
  return (
    <aside className={`cost-meter${m.ceilingHit ? " cost-meter-over" : ""}`} aria-live="polite" aria-label="Usage and cost">
      <span className="cost-item">
        <span className="cost-num">{m.calls}</span>
        <span className="cost-unit">{m.ceiling ? `/ ${m.ceiling} calls` : "calls"}</span>
      </span>
      <span className="cost-item">
        <span className="cost-num">{tokens.toLocaleString()}</span>
        <span className="cost-unit">tokens</span>
      </span>
      <span className="cost-item">
        <span className="cost-num">${m.totalCostUsd.toFixed(4)}</span>
        <span className="cost-unit">est.</span>
      </span>
      {m.ceiling > 0 && (
        <span
          className="cost-bar"
          role="progressbar"
          aria-label="Invocation ceiling usage"
          aria-valuemin={0}
          aria-valuemax={m.ceiling}
          aria-valuenow={Math.min(m.calls, m.ceiling)}
        >
          <span className="cost-bar-fill" style={{ width: `${Math.min(100, (m.calls / m.ceiling) * 100)}%` }} />
        </span>
      )}
      {m.ceilingHit && <span className="cost-warn">⚠ ceiling reached</span>}
    </aside>
  );
}
