import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PromptBar } from "../components/PromptBar.js";

export function IntakeScreen() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (fn: () => Promise<{ id: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await fn();
      navigate(`/job/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="intake">
      <div className="intake-hero">
        <h1>Turn a one-line stack into tested Claude Skills</h1>
        <p className="intake-sub">
          Describe your project. Skill Smith scopes it, asks a few questions, then (in later phases)
          researches, generates, and self-tests a set of Agent Skills.
        </p>
      </div>
      <PromptBar onSubmit={(d) => start(() => api.createJob(d))} onSayHi={() => start(() => api.sayHi())} busy={busy} />
      {error && <p className="error-banner" role="alert">{error}</p>}
    </main>
  );
}
