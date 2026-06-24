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

export type ResearchDomainStatus = "pending" | "running" | "done" | "failed";

export interface ResearchDomainState {
  domain: string;
  slug: string;
  status: ResearchDomainStatus;
  error?: string;
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

// ---- Stage 2: design ----
export interface SkillPlanItem {
  name: string;
  slug: string;
  description: string;
  scopeBoundaries: string;
  sourceDomains: string[];
}
export type DesignStatus = "pending" | "running" | "awaiting_approval" | "done" | "failed";
export interface DesignState {
  status: DesignStatus;
  skills: SkillPlanItem[];
}

// ---- Stage 3: generation ----
export type SkillGenStatus = "pending" | "running" | "done" | "failed";
export interface SkillValidation {
  ok: boolean;
  descriptionChars: number;
  bodyLines: number;
  hasReferences: boolean;
  issues: string[];
}
export interface GeneratedSkill {
  name: string;
  slug: string;
  status: SkillGenStatus;
  error?: string;
  validation?: SkillValidation;
}
export type GenerationStatus = "pending" | "running" | "done" | "done_with_warnings" | "failed";
export interface GenerationState {
  status: GenerationStatus;
  skills: GeneratedSkill[];
}

// ---- Stage 4: self-test ----
export type SelfTestSkillStatus = "pending" | "running" | "done" | "failed";
export interface SelfTestSkill {
  name: string;
  slug: string;
  status: SelfTestSkillStatus;
  triggerRate?: number;
  falseTriggerRate?: number;
  capabilityScore?: number;
  passed?: boolean;
  iterations?: number;
  error?: string;
}
export type SelfTestStatus = "pending" | "running" | "done" | "done_with_warnings" | "failed";
export interface SelfTestState {
  status: SelfTestStatus;
  skills: SelfTestSkill[];
}

export interface ResearchSource {
  title: string;
  url: string;
}

// ---- Stage 5: package + results ----
export interface ResultSkill {
  name: string;
  slug: string;
  passed: boolean;
  triggerRate?: number;
  capabilityScore?: number;
  descriptionChars: number;
  bodyLines: number;
  sources: ResearchSource[];
  packageRelPath?: string;
  installHints: { personal: string; project: string };
  error?: string;
}
export type ResultsStatus = "pending" | "running" | "done" | "done_with_warnings" | "failed";
export interface ResultsState {
  status: ResultsStatus;
  skills: ResultSkill[];
  packageAllRelPath?: string;
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
  research?: ResearchState;
  design?: DesignState;
  generation?: GenerationState;
  selftest?: SelfTestState;
  results?: ResultsState;
  meter: Meter;
}
