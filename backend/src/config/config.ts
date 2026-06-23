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
  research: z.array(z.string()).default(["WebSearch", "WebFetch", "Read", "Bash"]),
  design: z.array(z.string()).default([]),
  generate: z.array(z.string()).default(["Read", "Write", "Edit", "Bash"]),
  test: z.array(z.string()).default(["Read", "Bash"]),
  package: z.array(z.string()).default(["Read", "Bash"]),
});

export const ConfigSchema = z.object({
  model: z.string().default("claude-opus-4-8"),
  bare: z.boolean().default(false),
  claudeBin: z.string().min(1).default("claude"),
  workspaceDir: z.string().min(1).default("./workspace"),
  maxParallelism: z.number().int().min(1).default(3),
  perJobInvocationCeiling: z.number().int().min(1).default(40),
  retry: RetrySchema.default({}),
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
    toolPermissions: { ...base.toolPermissions },
  };
  if (env.SKILL_SMITH_MODEL !== undefined) next.model = env.SKILL_SMITH_MODEL;
  const b = bool(env.SKILL_SMITH_BARE);
  if (b !== undefined) next.bare = b;
  if (env.SKILL_SMITH_CLAUDE_BIN) next.claudeBin = env.SKILL_SMITH_CLAUDE_BIN;
  if (env.SKILL_SMITH_WORKSPACE_DIR) next.workspaceDir = env.SKILL_SMITH_WORKSPACE_DIR;
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
