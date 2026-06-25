import { spawn } from "node:child_process";
import type { Config } from "../config/config.js";
import type { GlobalBudget } from "../util/globalBudget.js";
import { Semaphore, sleep } from "../util/semaphore.js";
import { NON_RETRYABLE_ERRORS, type ClaudeEvent, type ResultInfo } from "./events.js";
import { StreamParser } from "./streamParser.js";

export interface StreamOptions {
  prompt: string;
  /** --allowed-tools list (already scoped per stage). */
  tools?: string[];
  /** Optional working directory for the spawned CLI. */
  cwd?: string;
  /** Called for every parsed event (system/assistant/stream_event/result/api_retry/unknown). */
  onEvent?: (event: ClaudeEvent) => void;
  /** Convenience: called with each streamed text delta. */
  onText?: (text: string) => void;
  /** Called with each raw stdout chunk (for persistence to raw/<callId>.ndjson). */
  onRaw?: (chunk: string) => void;
  /** Surface our own retry attempts (distinct from the CLI's internal api_retry). */
  onAttempt?: (attempt: number, maxRetries: number, delayMs: number, reason: string) => void;
  signal?: AbortSignal;
}

export interface StructuredOptions<T = unknown> {
  prompt: string;
  jsonSchema: object;
  tools?: string[];
  cwd?: string;
  /**
   * Pin this call to a specific CLI session id. Combined with `resume`, this lets
   * an interrupted call continue its existing conversation instead of restarting.
   */
  sessionId?: string;
  /** Resume `sessionId` (continue a prior, interrupted session) rather than starting it fresh. */
  resume?: boolean;
  onRaw?: (chunk: string) => void;
  onAttempt?: (attempt: number, maxRetries: number, delayMs: number, reason: string) => void;
  signal?: AbortSignal;
}

export interface StreamResult {
  info: ResultInfo;
  text: string;
}

export interface StructuredResult<T = unknown> {
  info: ResultInfo;
  /** The schema-conforming `structured_output` from the CLI. */
  structuredOutput: T;
  /** Plain-text `result` field, if any. */
  resultText?: string;
}

class ClaudeError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly info?: ResultInfo) {
    super(message);
    this.name = "ClaudeError";
  }
}

interface SpawnOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Wrapper around the Claude Code headless CLI. Always spawns with an args ARRAY
 * (never a shell string) so a user's project description can't inject shell
 * commands. Retries retryable failures with exponential backoff.
 */
export class ClaudeClient {
  private readonly semaphore: Semaphore;

  constructor(
    private readonly config: Config,
    semaphore?: Semaphore,
    private readonly budget?: GlobalBudget,
  ) {
    this.semaphore = semaphore ?? new Semaphore(config.maxParallelism);
  }

  /** Streaming call (`--output-format stream-json`). Resolves once a clean result arrives. */
  async stream(opts: StreamOptions): Promise<StreamResult> {
    const args = [
      "-p",
      opts.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    if (this.config.bare) args.push("--bare");
    if (this.config.model) args.push("--model", this.config.model);
    if (opts.tools && opts.tools.length > 0) args.push("--allowed-tools", opts.tools.join(","));

    return this.withRetry(opts.onAttempt, opts.signal, async () => {
      const parser = new StreamParser();
      let text = "";
      let result: ResultInfo | undefined;

      const onChunk = (chunk: string) => {
        opts.onRaw?.(chunk);
        for (const ev of parser.feed(chunk)) {
          if (ev.kind === "stream_event" && ev.textDelta) {
            text += ev.textDelta;
            opts.onText?.(ev.textDelta);
          }
          if (ev.kind === "result") result = ev.info;
          opts.onEvent?.(ev);
        }
      };

      const outcome = await this.spawnOnce(args, opts.cwd, opts.signal, onChunk);
      for (const ev of parser.flush()) {
        if (ev.kind === "result") result = ev.info;
        opts.onEvent?.(ev);
      }

      this.assertOk(outcome, result);
      return {
        info: result ?? { totalCostUsd: 0, inputTokens: 0, outputTokens: 0, isError: false },
        text,
      } satisfies StreamResult;
    });
  }

  /** Structured call (`--output-format json --json-schema ...`). */
  async structured<T = unknown>(opts: StructuredOptions<T>): Promise<StructuredResult<T>> {
    const args = [
      "-p",
      opts.prompt,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(opts.jsonSchema),
    ];
    if (this.config.bare) args.push("--bare");
    if (this.config.model) args.push("--model", this.config.model);
    if (opts.sessionId) {
      // --resume continues an existing (interrupted) session; --session-id pins a fresh one.
      if (opts.resume) args.push("--resume", opts.sessionId);
      else args.push("--session-id", opts.sessionId);
    }
    if (opts.tools && opts.tools.length > 0) args.push("--allowed-tools", opts.tools.join(","));

    return this.withRetry(opts.onAttempt, opts.signal, async () => {
      let stdout = "";
      const outcome = await this.spawnOnce(args, opts.cwd, opts.signal, (chunk) => {
        stdout += chunk;
        opts.onRaw?.(chunk);
      });

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        throw new ClaudeError(`Could not parse claude json output (exit ${outcome.code})`, outcome.code !== 0);
      }
      const usage = (parsed["usage"] as Record<string, unknown>) ?? {};
      const info: ResultInfo = {
        totalCostUsd: Number(parsed["total_cost_usd"] ?? 0) || 0,
        inputTokens: Number(usage["input_tokens"] ?? 0) || 0,
        outputTokens: Number(usage["output_tokens"] ?? 0) || 0,
        sessionId: typeof parsed["session_id"] === "string" ? (parsed["session_id"] as string) : undefined,
        isError: parsed["is_error"] === true,
        errorClass: typeof parsed["error"] === "string" ? (parsed["error"] as string) : undefined,
      };
      this.assertOk(outcome, info);
      return {
        info,
        structuredOutput: parsed["structured_output"] as T,
        resultText: typeof parsed["result"] === "string" ? (parsed["result"] as string) : undefined,
      } satisfies StructuredResult<T>;
    });
  }

  private assertOk(outcome: SpawnOutcome, info: ResultInfo | undefined): void {
    if (outcome.code !== 0) {
      throw new ClaudeError(
        `claude exited ${outcome.code}: ${outcome.stderr.slice(0, 500)}`,
        true,
        info,
      );
    }
    if (info?.isError) {
      const cls = info.errorClass ?? "unknown";
      throw new ClaudeError(`claude reported error: ${cls}`, !NON_RETRYABLE_ERRORS.has(cls), info);
    }
  }

  private async withRetry<T>(
    onAttempt: StreamOptions["onAttempt"],
    signal: AbortSignal | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Process-wide daily cost guardrail: reserve one invocation up front.
    if (this.budget && !this.budget.tryConsume()) {
      throw new ClaudeError("Global daily invocation budget reached", false);
    }
    const max = this.config.retry.maxRetries;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.semaphore.run(fn);
      } catch (err) {
        const retryable = err instanceof ClaudeError ? err.retryable : true;
        if (!retryable || attempt >= max || signal?.aborted) throw err;
        attempt += 1;
        const delay = Math.min(
          this.config.retry.maxDelayMs,
          this.config.retry.baseDelayMs * 2 ** (attempt - 1),
        );
        const jitter = delay > 0 ? Math.floor(Math.random() * (delay / 4)) : 0;
        onAttempt?.(attempt, max, delay + jitter, err instanceof Error ? err.message : String(err));
        await sleep(delay + jitter);
      }
    }
  }

  private spawnOnce(
    args: string[],
    cwd: string | undefined,
    signal: AbortSignal | undefined,
    onChunk: (chunk: string) => void,
  ): Promise<SpawnOutcome> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.claudeBin, args, {
        cwd,
        signal,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
        stdout += d;
        onChunk(d);
      });
      child.stderr.on("data", (d: string) => {
        stderr += d;
      });
      child.on("error", (err) => reject(new ClaudeError(`spawn failed: ${err.message}`, true)));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }
}
