import type {
  DesignState,
  GeneratedSkill,
  Job,
  Meter,
  ResearchDomainState,
  ScopeQuestion,
  StageKey,
  StageStatus,
} from "../types.js";

export interface ConsoleLine {
  stageKey: string;
  text: string;
}

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface JobViewState {
  job: Job | null;
  consoleLines: ConsoleLine[];
  error: string | null;
  connection: ConnectionStatus;
}

export const initialState: JobViewState = {
  job: null,
  consoleLines: [],
  error: null,
  connection: "connecting",
};

export type JobAction =
  | { type: "job"; job: Job }
  | { type: "stage"; stageKey: StageKey; status: StageStatus }
  | { type: "log"; stageKey: string; text: string }
  | { type: "meter"; meter: Meter }
  | { type: "question"; questions: ScopeQuestion[] }
  | { type: "error"; message: string }
  | { type: "done"; stageKey: StageKey }
  | { type: "research"; domain: string; status: ResearchDomainState["status"]; summary?: ResearchDomainState["summary"]; error?: string }
  | { type: "design"; status: DesignState["status"]; skills?: DesignState["skills"] }
  | { type: "skill"; name: string; slug: string; status: GeneratedSkill["status"]; validation?: GeneratedSkill["validation"]; error?: string }
  | { type: "connection"; status: ConnectionStatus };

const MAX_LINES = 2000;

export function jobReducer(state: JobViewState, action: JobAction): JobViewState {
  switch (action.type) {
    case "job":
      // The full snapshot is authoritative — it replaces local job state.
      return { ...state, job: action.job };
    case "stage":
      return state.job
        ? { ...state, job: patchStage(state.job, action.stageKey, action.status) }
        : state;
    case "log": {
      const next = [...state.consoleLines, { stageKey: action.stageKey, text: action.text }];
      if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
      return { ...state, consoleLines: next };
    }
    case "meter":
      return state.job ? { ...state, job: { ...state.job, meter: action.meter } } : state;
    case "question":
      return state.job ? { ...state, job: { ...state.job, questions: action.questions } } : state;
    case "error":
      return { ...state, error: action.message };
    case "done":
      return state.job ? { ...state, job: patchStage(state.job, action.stageKey, "done") } : state;
    case "research":
      return state.job ? { ...state, job: upsertResearchDomain(state.job, action) } : state;
    case "design":
      return state.job
        ? {
            ...state,
            job: {
              ...state.job,
              design: { status: action.status, skills: action.skills ?? state.job.design?.skills ?? [] },
            },
          }
        : state;
    case "skill":
      return state.job ? { ...state, job: upsertGeneratedSkill(state.job, action) } : state;
    case "connection":
      return { ...state, connection: action.status };
    default:
      return state;
  }
}

function patchStage(job: Job, key: StageKey, status: StageStatus): Job {
  return {
    ...job,
    stages: job.stages.map((s) => (s.key === key ? { ...s, status } : s)),
  };
}

/** Add a research domain or update the matching one in place (keyed by domain name). */
function upsertResearchDomain(
  job: Job,
  action: { domain: string; status: ResearchDomainState["status"]; summary?: ResearchDomainState["summary"]; error?: string },
): Job {
  const existing = job.research?.domains ?? [];
  const idx = existing.findIndex((d) => d.domain === action.domain);
  const patch: Partial<ResearchDomainState> = { status: action.status };
  if (action.summary) patch.summary = action.summary;
  if (action.error) patch.error = action.error;

  let domains: ResearchDomainState[];
  if (idx >= 0) {
    domains = existing.map((d, i) => (i === idx ? { ...d, ...patch } : d));
  } else {
    domains = [...existing, { domain: action.domain, slug: action.domain, ...patch, status: action.status }];
  }
  return {
    ...job,
    research: { status: job.research?.status ?? "running", domains },
  };
}

/** Add or update a generated skill in place (keyed by slug). */
function upsertGeneratedSkill(
  job: Job,
  action: { name: string; slug: string; status: GeneratedSkill["status"]; validation?: GeneratedSkill["validation"]; error?: string },
): Job {
  const existing = job.generation?.skills ?? [];
  const idx = existing.findIndex((s) => s.slug === action.slug);
  const patch: Partial<GeneratedSkill> = { status: action.status };
  if (action.validation) patch.validation = action.validation;
  if (action.error) patch.error = action.error;

  let skills: GeneratedSkill[];
  if (idx >= 0) {
    skills = existing.map((s, i) => (i === idx ? { ...s, ...patch } : s));
  } else {
    skills = [...existing, { name: action.name, slug: action.slug, status: action.status, ...patch }];
  }
  return { ...job, generation: { status: job.generation?.status ?? "running", skills } };
}
