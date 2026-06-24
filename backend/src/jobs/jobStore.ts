import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { StageKeys } from "../config/config.js";
import { emptyMeter } from "../meter/costMeter.js";
import { eventsFile, jobDir, jobFile, planFile, rawFile, reportFile, researchFile, resultsFile, scopeFile } from "./jobPaths.js";
import type { Job, JobKind, JobSummary, ResearchBrief, ResultsState, Scope, SkillPlanItem, SkillReport, StageState } from "./types.js";

export interface CreateJobInput {
  description: string;
  kind?: JobKind;
  ceiling: number;
}

function initialStages(): StageState[] {
  return StageKeys.map((key) => ({ key, status: "pending" }));
}

/**
 * Disk-backed job store. Every write is atomic (temp file + rename) so a crash
 * never leaves a half-written job.json. The store is the single source of truth;
 * the browser holds only a derived view, so a refresh re-reads from here.
 */
export class JobStore {
  /** Per-job write mutex so concurrent update()s (e.g. parallel Stage-1 domains) don't clobber each other. */
  private locks = new Map<string, Promise<unknown>>();

  constructor(private readonly workspaceDir: string) {}

  /** Run `fn` exclusively per job id (serializes read-modify-write sections). */
  private runExclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      id,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  async create(input: CreateJobInput): Promise<Job> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const job: Job = {
      id,
      kind: input.kind ?? "skill",
      status: "active",
      description: input.description,
      createdAt: now,
      updatedAt: now,
      stages: initialStages(),
      meter: emptyMeter(input.ceiling),
    };
    await fsp.mkdir(path.join(jobDir(this.workspaceDir, id), "raw"), { recursive: true });
    await this.write(job);
    await fsp.writeFile(eventsFile(this.workspaceDir, id), "", "utf8");
    return job;
  }

  async get(id: string): Promise<Job | null> {
    try {
      const buf = await fsp.readFile(jobFile(this.workspaceDir, id), "utf8");
      return JSON.parse(buf) as Job;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (err instanceof Error && err.message.startsWith("Invalid job id")) return null;
      throw err;
    }
  }

  async list(): Promise<Job[]> {
    const base = path.resolve(this.workspaceDir);
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(base);
    } catch {
      return [];
    }
    const jobs: Job[] = [];
    for (const entry of entries) {
      const job = await this.get(entry).catch(() => null);
      if (job) jobs.push(job);
    }
    jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return jobs;
  }

  /** Compact, newest-first job summaries for the history list. */
  async listSummaries(): Promise<JobSummary[]> {
    const jobs = await this.list();
    return jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      description: j.description,
      status: j.status,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      skillCount: j.results?.skills.length ?? j.generation?.skills.length ?? j.design?.skills.length ?? 0,
      cost: j.meter.totalCostUsd,
      calls: j.meter.calls,
    }));
  }

  /** Read-modify-write a job atomically (serialized per job id). Throws if missing. */
  update(id: string, mutate: (job: Job) => void): Promise<Job> {
    return this.runExclusive(id, async () => {
      const job = await this.get(id);
      if (!job) throw new Error(`Job not found: ${id}`);
      mutate(job);
      job.updatedAt = new Date().toISOString();
      await this.write(job);
      return job;
    });
  }

  async writeScope(id: string, scope: Scope): Promise<void> {
    await this.writeAtomic(scopeFile(this.workspaceDir, id), JSON.stringify(scope, null, 2));
  }

  /** Persist a Stage-1 research brief to research/<slug>.json (atomic). */
  async writeBrief(id: string, domain: string, brief: ResearchBrief): Promise<void> {
    await this.writeAtomic(researchFile(this.workspaceDir, id, domain), JSON.stringify(brief, null, 2));
  }

  /** Persist the Stage-2 approved skill-set plan to plan.json (atomic). */
  async writePlan(id: string, skills: SkillPlanItem[]): Promise<void> {
    await this.writeAtomic(planFile(this.workspaceDir, id), JSON.stringify({ skills }, null, 2));
  }

  /** Persist a Stage-4 per-skill self-test report (atomic). */
  async writeReport(id: string, slug: string, report: SkillReport): Promise<void> {
    await this.writeAtomic(reportFile(this.workspaceDir, id, slug), JSON.stringify(report, null, 2));
  }

  /** Persist the Stage-5 assembled results (atomic). */
  async writeResults(id: string, results: ResultsState): Promise<void> {
    await this.writeAtomic(resultsFile(this.workspaceDir, id), JSON.stringify(results, null, 2));
  }

  async appendEvent(id: string, name: string, data: unknown): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), name, data }) + "\n";
    await fsp.appendFile(eventsFile(this.workspaceDir, id), line, "utf8");
  }

  /** Append raw claude output for one invocation (for debugging / partial recovery). */
  async appendRaw(id: string, callId: string, chunk: string): Promise<void> {
    const file = rawFile(this.workspaceDir, id, callId);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, chunk, "utf8");
  }

  dir(id: string): string {
    return jobDir(this.workspaceDir, id);
  }

  private async write(job: Job): Promise<void> {
    await this.writeAtomic(jobFile(this.workspaceDir, job.id), JSON.stringify(job, null, 2));
  }

  private async writeAtomic(target: string, contents: string): Promise<void> {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, contents, "utf8");
    await fsp.rename(tmp, target);
  }
}

/** Convenience for tests / one-off scripts. */
export function ensureWorkspace(workspaceDir: string): void {
  fs.mkdirSync(path.resolve(workspaceDir), { recursive: true });
}
