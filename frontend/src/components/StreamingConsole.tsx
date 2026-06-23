import { useEffect, useRef } from "react";
import type { ConsoleLine } from "../state/jobReducer.js";

export function StreamingConsole({ lines }: { lines: ConsoleLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="console-wrap">
      <div className="console-header">Live output</div>
      <div
        ref={ref}
        className="console"
        role="log"
        aria-live="polite"
        aria-label="Claude Code live output"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {lines.length === 0 ? (
          <span className="console-empty">Waiting for output…</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="console-line">
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
