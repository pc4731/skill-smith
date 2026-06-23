import type { Job, Scope } from "./types.js";

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
  createJob(description: string): Promise<{ id: string }> {
    return jsonFetch("/api/jobs", { method: "POST", body: JSON.stringify({ description }) });
  },
  sayHi(): Promise<{ id: string }> {
    return jsonFetch("/api/say-hi", { method: "POST" });
  },
  getJob(id: string): Promise<Job> {
    return jsonFetch(`/api/jobs/${id}`);
  },
  listJobs(): Promise<Job[]> {
    return jsonFetch("/api/jobs");
  },
  submitAnswers(
    id: string,
    payload: { answers?: Record<string, string | string[]>; useDefaults?: boolean },
  ): Promise<{ ok: boolean; scope: Scope }> {
    return jsonFetch(`/api/jobs/${id}/answers`, { method: "POST", body: JSON.stringify(payload) });
  },
};
