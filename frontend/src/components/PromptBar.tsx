import { useState } from "react";

interface Props {
  onSubmit: (description: string) => void;
  onSayHi: () => void;
  busy?: boolean;
}

export function PromptBar({ onSubmit, onSayHi, busy }: Props) {
  const [value, setValue] = useState("");
  const canSubmit = value.trim().length > 0 && !busy;

  return (
    <form
      className="prompt-bar"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(value.trim());
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
