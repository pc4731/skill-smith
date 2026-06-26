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
  /** USD cost of this domain's research call (so the UI can show per-domain spend). */
  cost?: number;
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

// ---- Stage 2: skill-set design ----
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

// ---- Stage 3: skill generation ----
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
  /** Set when this skill was seeded from an existing library skill and adapted. */
  reusedFrom?: { jobId: string; slug: string; name: string };
}

/** One generated skill surfaced in the cross-job library. */
export interface LibrarySkill {
  jobId: string;
  jobDescription: string;
  slug: string;
  name: string;
  description: string;
  createdAt: string;
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

/** Persisted per-skill self-test report (skills/<slug>/report.json). */
export interface SkillReport {
  slug: string;
  triggerRate: number;
  falseTriggerRate: number;
  capabilityScore: number;
  passed: boolean;
  iterations: number;
  issues: string[];
  prompts: { shouldTrigger: string[]; shouldNot: string[] };
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
  design?: DesignState;
  generation?: GenerationState;
  selftest?: SelfTestState;
  results?: ResultsState;
  meter: Meter;
  /** When true, generation may seed a new skill from a matching existing library skill. Off by default. */
  reuseSkills?: boolean;
  /** Free-text note, e.g. set when a job is reconciled after a server restart. */
  note?: string;
}

/** Compact job view for the history list (no heavy research/skill bodies). */
export interface JobSummary {
  id: string;
  kind: JobKind;
  description: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  skillCount: number;
  cost: number;
  calls: number;
}
