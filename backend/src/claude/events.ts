/**
 * Typed view over the Claude Code headless `--output-format stream-json` event stream.
 * See the claude-code-headless skill for the field contract. Parsing is defensive:
 * unknown event types map to `{ kind: "unknown" }` and are never thrown.
 */

export interface ResultInfo {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  sessionId?: string;
  isError: boolean;
  /** Error category from the CLI when present (e.g. rate_limit, invalid_request). */
  errorClass?: string;
  numTurns?: number;
  durationMs?: number;
}

export interface RetryInfo {
  attempt: number;
  maxRetries: number;
  retryDelayMs?: number;
  errorStatus: number | null;
  error: string;
}

export type ClaudeEvent =
  | { kind: "system"; subtype?: string; sessionId?: string; raw: unknown }
  | { kind: "api_retry"; info: RetryInfo; raw: unknown }
  | { kind: "assistant"; raw: unknown }
  | { kind: "stream_event"; textDelta?: string; raw: unknown }
  | { kind: "result"; info: ResultInfo; raw: unknown }
  | { kind: "unknown"; raw: unknown };

/** Error classes that should NOT be retried — failing again won't help. */
export const NON_RETRYABLE_ERRORS = new Set<string>([
  "authentication_failed",
  "oauth_org_not_allowed",
  "billing_error",
  "invalid_request",
  "model_not_found",
  "max_output_tokens",
]);

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Classify one already-parsed JSON object into a typed ClaudeEvent. */
export function classifyEvent(obj: unknown): ClaudeEvent {
  const o = asRecord(obj);
  const type = o["type"];
  switch (type) {
    case "system": {
      const subtype = typeof o["subtype"] === "string" ? (o["subtype"] as string) : undefined;
      if (subtype === "api_retry") {
        return {
          kind: "api_retry",
          info: {
            attempt: Number(o["attempt"] ?? 0),
            maxRetries: Number(o["max_retries"] ?? 0),
            retryDelayMs: o["retry_delay_ms"] === undefined ? undefined : Number(o["retry_delay_ms"]),
            errorStatus: o["error_status"] === null || o["error_status"] === undefined ? null : Number(o["error_status"]),
            error: String(o["error"] ?? "unknown"),
          },
          raw: obj,
        };
      }
      return {
        kind: "system",
        subtype,
        sessionId: typeof o["session_id"] === "string" ? (o["session_id"] as string) : undefined,
        raw: obj,
      };
    }
    case "assistant":
      return { kind: "assistant", raw: obj };
    case "stream_event": {
      const ev = asRecord(o["event"]);
      const delta = asRecord(ev["delta"]);
      const textDelta = delta["type"] === "text_delta" && typeof delta["text"] === "string"
        ? (delta["text"] as string)
        : undefined;
      return { kind: "stream_event", textDelta, raw: obj };
    }
    case "result": {
      const usage = asRecord(o["usage"]);
      return {
        kind: "result",
        info: {
          totalCostUsd: Number(o["total_cost_usd"] ?? 0) || 0,
          inputTokens: Number(usage["input_tokens"] ?? 0) || 0,
          outputTokens: Number(usage["output_tokens"] ?? 0) || 0,
          sessionId: typeof o["session_id"] === "string" ? (o["session_id"] as string) : undefined,
          isError: o["is_error"] === true,
          errorClass: typeof o["error"] === "string" ? (o["error"] as string) : undefined,
          numTurns: o["num_turns"] === undefined ? undefined : Number(o["num_turns"]),
          durationMs: o["duration_ms"] === undefined ? undefined : Number(o["duration_ms"]),
        },
        raw: obj,
      };
    }
    default:
      return { kind: "unknown", raw: obj };
  }
}
