// Mirrors the backend job.json / scope.json shapes (backend/src/jobs/types.ts).

export const STAGE_KEYS = ["scope", "research", "design", "generate", "test", "package"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_LABELS: Record<StageKey, string> = {
  scope: "Scope",
  research: "Research",
  design: "Design",
  generate: "Generate",
  test: "Test",
  package: "Package",
};

export type StageStatus =
  | "pending"
  | "running"
  | "awaiting_input"
  | "done"
  | "failed"
  | "skipped";

export type JobStatus = "active" | "awaiting_input" | "done" | "failed";

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
  kind: "skill" | "sayhi";
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
