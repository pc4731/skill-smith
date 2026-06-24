import path from "node:path";

/** Job ids must be simple slugs — no separators, no traversal. */
const JOB_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isValidJobId(id: string): boolean {
  return JOB_ID_RE.test(id) && id !== "." && id !== "..";
}

/**
 * Resolve the directory for a job and assert it stays inside workspaceDir.
 * Throws on a malicious or malformed id (path traversal defence).
 */
export function jobDir(workspaceDir: string, jobId: string): string {
  if (!isValidJobId(jobId)) {
    throw new Error(`Invalid job id: ${JSON.stringify(jobId)}`);
  }
  const base = path.resolve(workspaceDir);
  const dir = path.resolve(base, jobId);
  if (dir !== path.join(base, jobId) || !dir.startsWith(base + path.sep)) {
    throw new Error(`Refusing to escape workspace for job id: ${JSON.stringify(jobId)}`);
  }
  return dir;
}

export function jobFile(workspaceDir: string, jobId: string): string {
  return path.join(jobDir(workspaceDir, jobId), "job.json");
}

export function eventsFile(workspaceDir: string, jobId: string): string {
  return path.join(jobDir(workspaceDir, jobId), "events.ndjson");
}

export function scopeFile(workspaceDir: string, jobId: string): string {
  return path.join(jobDir(workspaceDir, jobId), "scope.json");
}

export function rawFile(workspaceDir: string, jobId: string, callId: string): string {
  if (!isValidJobId(callId)) {
    throw new Error(`Invalid call id: ${JSON.stringify(callId)}`);
  }
  return path.join(jobDir(workspaceDir, jobId), "raw", `${callId}.ndjson`);
}

/** Filesystem-safe slug for a domain name (used for research/<slug>.json). */
export function slug(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || "domain";
}

/** Path to a Stage-1 research brief; `name` is sanitized to a slug + confined to the job dir. */
export function researchFile(workspaceDir: string, jobId: string, name: string): string {
  const safe = slug(name);
  return path.join(jobDir(workspaceDir, jobId), "research", `${safe}.json`);
}

/** Stage-2 approved skill-set plan. */
export function planFile(workspaceDir: string, jobId: string): string {
  return path.join(jobDir(workspaceDir, jobId), "plan.json");
}

export function skillsDir(workspaceDir: string, jobId: string): string {
  return path.join(jobDir(workspaceDir, jobId), "skills");
}

/** Stage-3 generated skill directory; `name` is sanitized to a slug + confined to the job dir. */
export function skillDir(workspaceDir: string, jobId: string, name: string): string {
  return path.join(skillsDir(workspaceDir, jobId), slug(name));
}
