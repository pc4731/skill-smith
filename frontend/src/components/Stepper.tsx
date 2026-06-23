import { STAGE_KEYS, STAGE_LABELS, type Job, type StageStatus } from "../types.js";

const STATUS_ICON: Record<StageStatus, string> = {
  pending: "○",
  running: "◐",
  awaiting_input: "?",
  done: "✓",
  failed: "✕",
  skipped: "–",
};

const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "Pending",
  running: "Running",
  awaiting_input: "Awaiting input",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export function Stepper({ job }: { job: Job | null }) {
  const byKey = new Map((job?.stages ?? []).map((s) => [s.key, s.status] as const));
  return (
    <nav className="stepper" aria-label="Pipeline stages">
      <ol>
        {STAGE_KEYS.map((key) => {
          const status: StageStatus = byKey.get(key) ?? "pending";
          return (
            <li key={key} className={`step step-${status}`} data-status={status} data-stage={key}>
              <span className="step-icon" aria-hidden="true">{STATUS_ICON[status]}</span>
              <span className="step-label">{STAGE_LABELS[key]}</span>
              <span className="step-status">{STATUS_LABEL[status]}</span>
            </li>
          );
        })}
      </ol>
      <p className="stepper-note">Stages 2–6 (Research → Package) arrive in later phases.</p>
    </nav>
  );
}
