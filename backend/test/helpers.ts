import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type Config } from "../src/config/config.js";

export const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

// Ensure the mock CLI is executable so its shebang runs it directly.
try {
  fs.chmodSync(FAKE_CLAUDE, 0o755);
} catch {
  /* ignore */
}

export function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillsmith-test-"));
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return loadConfig({
    skipFile: true,
    env: {},
    overrides: {
      claudeBin: FAKE_CLAUDE,
      workspaceDir: tmpWorkspace(),
      retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 },
      ...overrides,
    },
  });
}

export function counterFile(): string {
  return path.join(os.tmpdir(), `skillsmith-counter-${Math.random().toString(36).slice(2)}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
