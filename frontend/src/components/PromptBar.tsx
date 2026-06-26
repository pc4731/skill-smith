import { useState } from "react";

interface Props {
  onSubmit: (description: string, reuse: boolean) => void;
  onSayHi: () => void;
  busy?: boolean;
}

export function PromptBar({ onSubmit, onSayHi, busy }: Props) {
  const [value, setValue] = useState("");
  const [reuse, setReuse] = useState(false); // opt-in skill reuse, off by default
  const canSubmit = value.trim().length > 0 && !busy;

  return (
    <form
      className="prompt-bar"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(value.trim(), reuse);
      }}
    >
      <label htmlFor="project-description" className="prompt-label">
        Describe your project
      </label>
      <textarea
        id="project-description"
        className="prompt-input"
        placeholder='e.g. "AEM project with React" or "Spring Boot REST + SOAP + SQL"'
        value={value}
        rows={3}
        onChange={(e) => setValue(e.target.value)}
      />
      <label className="prompt-reuse">
        <input
          type="checkbox"
          checked={reuse}
          onChange={(e) => setReuse(e.target.checked)}
          disabled={busy}
        />
        Reuse related existing skills (adapt a matching skill instead of generating from scratch)
      </label>
      <div className="prompt-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Generate skills
        </button>
        <button type="button" className="btn btn-ghost" onClick={onSayHi} disabled={busy}>
          Test connection (say hi)
        </button>
      </div>
    </form>
  );
}
