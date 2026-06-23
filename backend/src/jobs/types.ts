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
  meter: Meter;
}
