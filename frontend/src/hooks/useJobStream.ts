import { useEffect, useReducer } from "react";
import { api } from "../api.js";
import { initialState, jobReducer, type JobAction } from "../state/jobReducer.js";

const SSE_EVENTS = ["job", "stage", "log", "meter", "question", "retry", "error", "done"] as const;

/**
 * Subscribe to a job by id. On mount it SEEDS state from GET /api/jobs/:id (so a
 * cold load or refresh with only the URL fully rebuilds state from the backend),
 * then opens an EventSource for live updates. EventSource auto-reconnects; the
 * backend replays its buffer on reconnect, so the view self-heals.
 */
export function useJobStream(jobId: string | undefined) {
  const [state, dispatch] = useReducer(jobReducer, initialState);

  useEffect(() => {
    if (!jobId) return;
    let closed = false;

    api
      .getJob(jobId)
      .then((job) => {
        if (!closed) dispatch({ type: "job", job });
      })
      .catch((err) => {
        if (!closed) dispatch({ type: "error", message: String(err.message ?? err) });
      });

    const source = new EventSource(`/api/jobs/${jobId}/stream`);
    source.onopen = () => dispatch({ type: "connection", status: "open" });
    source.onerror = () => dispatch({ type: "connection", status: "reconnecting" });

    for (const name of SSE_EVENTS) {
      source.addEventListener(name, (ev) => {
        const data = safeParse((ev as MessageEvent).data);
        dispatch(toAction(name, data));
      });
    }

    return () => {
      closed = true;
      source.close();
    };
  }, [jobId]);

  return { state, dispatch };
}

function safeParse(data: unknown): any {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function toAction(name: (typeof SSE_EVENTS)[number], data: any): JobAction {
  switch (name) {
    case "job":
      return { type: "job", job: data };
    case "stage":
      return { type: "stage", stageKey: data.stageKey, status: data.status };
    case "log":
      return { type: "log", stageKey: data.stageKey ?? "", text: data.text ?? "" };
    case "meter":
      return { type: "meter", meter: data };
    case "question":
      return { type: "question", questions: data.questions ?? [] };
    case "done":
      return { type: "done", stageKey: data.stageKey };
    case "retry":
      return { type: "log", stageKey: "scope", text: `↻ retry ${data.attempt}/${data.maxRetries}: ${data.reason ?? ""}` };
    case "error":
    default:
      return { type: "error", message: data.message ?? "Unknown error" };
  }
}
