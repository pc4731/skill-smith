import type { StageKey } from "../config/config.js";

export type StageStatus =
  | "pending"
  | "running"
  | "awaiting_input"
  | "done"
  | "failed"
  | "skipped";

export type JobStatus = "active" | "awaiting_input" | "done" | "failed";

export type JobKind = "skill" | "sayhi";

export interface StageState {
  key: StageKey;
  status: StageStatus;
  startedAt?: string;
  endedAt?: string;
  error?: string;
}

export interface Meter {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  ceiling: number;
  ceilingHit: boolean;
}

export type QuestionType = "single" | "multi" | "text";

export interface ScopeQuestion {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[];
}

export interface Scope {
  targetStack: string;
  domains: string[];
  likelyTasks: string[];
  questions: ScopeQuestion[];
  answers?: Record<string, string | string[]>;
  usedDefaults?: boolean;
}

export interface ResearchSource {
  title: string;
  url: string;
}

/** A versioned, cited research brief for one knowledge domain (Stage 1). */
export interface ResearchBrief {
  domain: string;
  key_apis: string[];
  idioms: string[];
  gotchas: string[];
  version_notes: string;
  sources: ResearchSource[];
}

export type ResearchDomainStatus = "pending" | "running" | "done" | "failed";

export interface ResearchDomainState {
  domain: string;
  /** Filesystem-safe slug used for research/<slug>.json. */
  slug: string;
  status: ResearchDomainStatus;
  error?: string;
  /** Compact summary kept in job.json; the full brief lives in research/<slug>.json. */
  summary?: { keyApis: number; gotchas: number; sources: number };
}

export type ResearchStatus =
  | "pending"
  | "running"
  | "done"
  | "done_with_warnings"
  | "failed";

export interface ResearchState {
  status: ResearchStatus;
  domains: ResearchDomainState[];
}

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  description: string;
  createdAt: string;
  updatedAt: string;
  stages: StageState[];
  scope?: Scope;
  questions?: ScopeQuestion[];
  answers?: Record<string, string | string[]>;
  research?: ResearchState;
  meter: Meter;
}
