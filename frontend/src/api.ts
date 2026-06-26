import type { Job, JobSummary, LibrarySkill, Scope } from "./types.js";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

export const api = {
  createJob(description: string, reuse = false): Promise<{ id: string }> {
    return jsonFetch("/api/jobs", { method: "POST", body: JSON.stringify({ description, reuse }) });
  },
  listSkills(): Promise<LibrarySkill[]> {
    return jsonFetch("/api/skills");
  },
  sayHi(): Promise<{ id: string }> {
    return jsonFetch("/api/say-hi", { method: "POST" });
  },
  getJob(id: string): Promise<Job> {
    return jsonFetch(`/api/jobs/${id}`);
  },
  listJobs(): Promise<JobSummary[]> {
    return jsonFetch("/api/jobs");
  },
  rerunJob(id: string): Promise<{ id: string }> {
    return jsonFetch(`/api/jobs/${id}/rerun`, { method: "POST" });
  },
  /** Resume Stage 1 research — re-runs only domains without a brief on disk (failed/pending). */
  resumeResearch(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`/api/jobs/${id}/research`, { method: "POST" });
  },
  /** Resume Stage 3 generation — re-runs only skills missing a valid SKILL.md (failed/pending). */
  resumeGeneration(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`/api/jobs/${id}/generate`, { method: "POST" });
  },
  /** Resume Stage 4 self-test — re-runs only skills without a passing report (failed/pending). */
  resumeSelfTest(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`/api/jobs/${id}/test`, { method: "POST" });
  },
  submitAnswers(
    id: string,
    payload: { answers?: Record<string, string | string[]>; useDefaults?: boolean },
  ): Promise<{ ok: boolean; scope: Scope }> {
    return jsonFetch(`/api/jobs/${id}/answers`, { method: "POST", body: JSON.stringify(payload) });
  },
  approvePlan(
    id: string,
    payload: { approve?: boolean; skills?: unknown[] },
  ): Promise<{ ok: boolean; skills: unknown[] }> {
    return jsonFetch(`/api/jobs/${id}/plan`, { method: "POST", body: JSON.stringify(payload) });
  },
};
