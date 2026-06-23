import { ClaudeClient } from "./claude/claudeClient.js";
import { loadConfig, type Config, type LoadOptions } from "./config/config.js";
import { JobStore } from "./jobs/jobStore.js";
import { SseHub } from "./sse/sseHub.js";
import { Semaphore } from "./util/semaphore.js";

/** Everything the routes and stages depend on, wired once and injected. */
export interface AppContext {
  config: Config;
  jobStore: JobStore;
  sse: SseHub;
  claude: ClaudeClient;
}

export interface BuildContextOptions extends LoadOptions {
  /** Provide a fully-formed config (skips loading). */
  config?: Config;
  /** Disable the SSE heartbeat interval (tests). */
  heartbeatMs?: number;
}

export function buildContext(opts: BuildContextOptions = {}): AppContext {
  const config = opts.config ?? loadConfig(opts);
  const semaphore = new Semaphore(config.maxParallelism);
  return {
    config,
    jobStore: new JobStore(config.workspaceDir),
    sse: new SseHub(2000, opts.heartbeatMs ?? 15000),
    claude: new ClaudeClient(config, semaphore),
  };
}
