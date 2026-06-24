import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { Clarifier } from "../components/Clarifier.js";
import { CostMeter } from "../components/CostMeter.js";
import { ResearchCards } from "../components/ResearchCards.js";
import { ResultsView } from "../components/ResultsView.js";
import { SelfTestCards } from "../components/SelfTestCards.js";
import { SkillCards } from "../components/SkillCards.js";
import { SkillPlan } from "../components/SkillPlan.js";
import { Stepper } from "../components/Stepper.js";
import { StreamingConsole } from "../components/StreamingConsole.js";
import { useJobStream } from "../hooks/useJobStream.js";

export function RunScreen() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useJobStream(id);
  const [busy, setBusy] = useState(false);
  const { job, consoleLines, error } = state;

  const scopeStage = job?.stages.find((s) => s.key === "scope");
  const awaiting = scopeStage?.status === "awaiting_input";
  const scopeDone = scopeStage?.status === "done";
  const questions = job?.questions ?? job?.scope?.questions ?? [];

  const submit = async (payload: { answers?: Record<string, string | string[]>; useDefaults?: boolean }) => {
    if (!id) return;
    setBusy(true);
    try {
      await api.submitAnswers(id, payload);
      const fresh = await api.getJob(id);
      dispatch({ type: "job", job: fresh });
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const approvePlan = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await api.approvePlan(id, { approve: true });
      const fresh = await api.getJob(id);
      dispatch({ type: "job", job: fresh });
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const designAwaiting = job?.design?.status === "awaiting_approval";

  return (
    <main className="run">
      <div className="run-grid">
        <Stepper job={job} />
        <section className="stage-panel">
          {job && <p className="run-desc">{job.description}</p>}
          {error && <p className="error-banner" role="alert">{error}</p>}

          <StreamingConsole lines={consoleLines} />

          {awaiting && (
            <Clarifier
              questions={questions}
              busy={busy}
              onSubmit={(answers) => submit({ answers })}
              onUseDefaults={() => submit({ useDefaults: true })}
            />
          )}

          {job?.research && <ResearchCards research={job.research} />}

          {designAwaiting && job?.design && (
            <SkillPlan design={job.design} busy={busy} onApprove={approvePlan} />
          )}

          {job?.generation && <SkillCards generation={job.generation} />}

          {job?.selftest && <SelfTestCards selftest={job.selftest} />}

          {id && job?.results && <ResultsView jobId={id} results={job.results} />}

          {scopeDone && !job?.research && (
            <div className="stage-done" role="status">
              <strong>Stage 0 complete.</strong> The scope is saved; research is starting.
            </div>
          )}
        </section>
      </div>
      <CostMeter meter={job?.meter} />
    </main>
  );
}
