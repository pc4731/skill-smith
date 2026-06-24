import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Skill Smith configuration. Loaded from skill-smith.config.json at the repo root,
 * then overlaid with environment variables, then validated and frozen.
 *
 * Web tools are intentionally only ever granted to the `research` stage.
 */

export const StageKeys = ["scope", "research", "design", "generate", "test", "package"] as const;
export type StageKey = (typeof StageKeys)[number];

const RetrySchema = z.object({
  maxRetries: z.number().int().min(0).default(3),
  baseDelayMs: z.number().int().min(0).default(1000),
  maxDelayMs: z.number().int().min(0).default(30000),
});

const ToolPermissionsSchema = z.object({
  scope: z.array(z.string()).default([]),
  // Research only needs to search + fetch and return a JSON brief. Deliberately NO Bash:
  // an agent ingesting untrusted web content must not also hold shell execution (prompt-injection -> RCE).
  research: z.array(z.string()).default(["WebSearch", "WebFetch"]),
  design: z.array(z.string()).default([]),
  // Generation writes the skill directory with Read/Write/Edit. Deliberately NO Bash:
  // the model authors files from (web-sourced) research, so shell access would be a needless RCE surface.
  generate: z.array(z.string()).default(["Read", "Write", "Edit"]),
  // Stage-4 capability check runs a representative task with the (model-generated) skill loaded.
  // Read/Write/Edit only — NO Bash (no shell for an agent running untrusted generated content), NO web.
  test: z.array(z.string()).default(["Read", "Write", "Edit"]),
  package: z.array(z.string()).default(["Read", "Bash"]),
});

export const ConfigSchema = z.object({
  model: z.string().default("claude-opus-4-8"),
  bare: z.boolean().default(false),
  claudeBin: z.string().min(1).default("claude"),
  workspaceDir: z.string().min(1).default("./workspace"),
  /** Interface the backend binds to. Defaults to localhost so the cost-incurring
   * API is not exposed on all interfaces; set to 0.0.0.0 only behind auth/a proxy. */
  host: z.string().min(1).default("127.0.0.1"),
  /** Reject project descriptions longer than this (chars) to bound prompt size/cost. */
  maxDescriptionLength: z.number().int().min(1).default(4000),
  /** Process-wide cap on claude invocations per UTC day (0 = unlimited). */
  globalDailyInvocationCeiling: z.number().int().min(0).default(0),
  maxParallelism: z.number().int().min(1).default(3),
  // Stage 4 (self-test) is invocation-heavy (prompt-gen + judge*trials + capability + grade per skill),
  // so the per-job ceiling is generous; the global daily ceiling is the harder cost cap.
  perJobInvocationCeiling: z.number().int().min(1).default(150),
  retry: RetrySchema.default({}),
  selfTest: z
    .object({
      triggerThreshold: z.number().min(0).max(1).default(0.8),
      trials: z.number().int().min(1).default(3),
      maxIterations: z.number().int().min(1).default(3),
    })
    .default({}),
  toolPermissions: ToolPermissionsSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Strip the inline `_comment` / `_field` doc keys before validation. */
function stripDocKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_") || k === "$schema") continue;
    out[k] = v;
  }
  return out;
}

function num(envVal: string | undefined): number | undefined {
  if (envVal === undefined || envVal === "") return undefined;
  const n = Number(envVal);
  return Number.isFinite(n) ? n : undefined;
}

function bool(envVal: string | undefined): boolean | undefined {
  if (envVal === undefined || envVal === "") return undefined;
  return envVal === "true" || envVal === "1";
}

/** Overlay environment variables onto a parsed config object (env wins). */
export function applyEnv(base: Config, env: NodeJS.ProcessEnv = process.env): Config {
  const next: Config = {
    ...base,
    retry: { ...base.retry },
    selfTest: { ...base.selfTest },
    toolPermissions: { ...base.toolPermissions },
  };
  if (env.SKILL_SMITH_MODEL !== undefined) next.model = env.SKILL_SMITH_MODEL;
  const b = bool(env.SKILL_SMITH_BARE);
  if (b !== undefined) next.bare = b;
  if (env.SKILL_SMITH_CLAUDE_BIN) next.claudeBin = env.SKILL_SMITH_CLAUDE_BIN;
  if (env.SKILL_SMITH_WORKSPACE_DIR) next.workspaceDir = env.SKILL_SMITH_WORKSPACE_DIR;
  if (env.SKILL_SMITH_HOST) next.host = env.SKILL_SMITH_HOST;
  const maxDesc = num(env.SKILL_SMITH_MAX_DESCRIPTION_LENGTH);
  if (maxDesc !== undefined) next.maxDescriptionLength = maxDesc;
  const dailyCeil = num(env.SKILL_SMITH_DAILY_INVOCATION_CEILING);
  if (dailyCeil !== undefined) next.globalDailyInvocationCeiling = dailyCeil;
  const par = num(env.SKILL_SMITH_MAX_PARALLELISM);
  if (par !== undefined) next.maxParallelism = par;
  const ceil = num(env.SKILL_SMITH_INVOCATION_CEILING);
  if (ceil !== undefined) next.perJobInvocationCeiling = ceil;
  const rm = num(env.SKILL_SMITH_RETRY_MAX);
  if (rm !== undefined) next.retry.maxRetries = rm;
  const rb = num(env.SKILL_SMITH_RETRY_BASE_DELAY_MS);
  if (rb !== undefined) next.retry.baseDelayMs = rb;
  const rx = num(env.SKILL_SMITH_RETRY_MAX_DELAY_MS);
  if (rx !== undefined) next.retry.maxDelayMs = rx;
  const tt = num(env.SKILL_SMITH_TRIGGER_THRESHOLD);
  if (tt !== undefined) next.selfTest.triggerThreshold = tt;
  const tr = num(env.SKILL_SMITH_SELFTEST_TRIALS);
  if (tr !== undefined) next.selfTest.trials = tr;
  const mi = num(env.SKILL_SMITH_SELFTEST_MAX_ITERATIONS);
  if (mi !== undefined) next.selfTest.maxIterations = mi;
  return next;
}

export interface LoadOptions {
  /** Path to the JSON config file. Defaults to <repoRoot>/skill-smith.config.json. */
  configPath?: string;
  /** Skip reading the file (use schema defaults as the base). */
  skipFile?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Explicit overrides applied LAST (used by tests). */
  overrides?: Partial<Config>;
}

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "..", "skill-smith.config.json");

export function loadConfig(opts: LoadOptions = {}): Config {
  let fileObj: Record<string, unknown> = {};
  if (!opts.skipFile) {
    const candidates = [
      opts.configPath,
      path.resolve(process.cwd(), "skill-smith.config.json"),
      DEFAULT_CONFIG_PATH,
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        fileObj = JSON.parse(fs.readFileSync(p, "utf8"));
        break;
      }
    }
  }
  const parsed = ConfigSchema.parse(stripDocKeys(fileObj));
  const withEnv = applyEnv(parsed, opts.env ?? process.env);
  const merged = opts.overrides
    ? ConfigSchema.parse({ ...withEnv, ...opts.overrides })
    : withEnv;
  return Object.freeze(merged);
}

/** Tools allowed for a given stage (empty unless explicitly configured). */
export function toolsFor(config: Config, stage: StageKey): string[] {
  return config.toolPermissions[stage] ?? [];
}
