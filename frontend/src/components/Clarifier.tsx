import { useState } from "react";
import type { ScopeQuestion } from "../types.js";

interface Props {
  questions: ScopeQuestion[];
  onSubmit: (answers: Record<string, string | string[]>) => void;
  onUseDefaults: () => void;
  busy?: boolean;
}

type AnswerMap = Record<string, string | string[]>;

export function Clarifier({ questions, onSubmit, onUseDefaults, busy }: Props) {
  const [answers, setAnswers] = useState<AnswerMap>({});

  const setSingle = (id: string, value: string) => setAnswers((a) => ({ ...a, [id]: value }));
  const toggleMulti = (id: string, value: string) =>
    setAnswers((a) => {
      const current = Array.isArray(a[id]) ? (a[id] as string[]) : [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...a, [id]: next };
    });

  return (
    <section className="clarifier" aria-label="Clarifying questions">
      <h2 className="clarifier-title">A few questions before we research your stack</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSubmit(answers);
        }}
      >
        {questions.map((q) => (
          <fieldset key={q.id} className="question-card">
            <legend className="question-text">{q.question}</legend>

            {q.type === "single" && (
              <div className="chip-group" role="radiogroup" aria-label={q.question}>
                {(q.options ?? []).map((opt) => {
                  const checked = answers[q.id] === opt;
                  return (
                    <label key={opt} className={`chip${checked ? " chip-selected" : ""}`}>
                      <input
                        type="radio"
                        name={q.id}
                        value={opt}
                        checked={checked}
                        onChange={() => setSingle(q.id, opt)}
                      />
                      <span className="chip-check" aria-hidden="true">{checked ? "✓" : ""}</span>
                      {opt}
                    </label>
                  );
                })}
              </div>
            )}

            {q.type === "multi" && (
              <div className="chip-group" role="group" aria-label={q.question}>
                {(q.options ?? []).map((opt) => {
                  const arr = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
                  const checked = arr.includes(opt);
                  return (
                    <label key={opt} className={`chip${checked ? " chip-selected" : ""}`}>
                      <input
                        type="checkbox"
                        name={q.id}
                        value={opt}
                        checked={checked}
                        onChange={() => toggleMulti(q.id, opt)}
                      />
                      <span className="chip-check" aria-hidden="true">{checked ? "✓" : ""}</span>
                      {opt}
                    </label>
                  );
                })}
              </div>
            )}

            {q.type === "text" && (
              <input
                type="text"
                className="text-answer"
                aria-label={q.question}
                value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                onChange={(e) => setSingle(q.id, e.target.value)}
              />
            )}
          </fieldset>
        ))}

        <div className="clarifier-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Submit answers
          </button>
          <button type="button" className="btn btn-ghost" onClick={onUseDefaults} disabled={busy}>
            Use defaults
          </button>
        </div>
      </form>
    </section>
  );
}
