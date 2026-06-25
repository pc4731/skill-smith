import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toolsFor } from "../config/config.js";
import type { AppContext } from "../context.js";
import { slug } from "../jobs/jobPaths.js";
import type { ResearchBrief, ResearchDomainState, ResearchState } from "../jobs/types.js";
import { applyResult, ceilingReached } from "../meter/costMeter.js";
import { emit, emitJob } from "../runtime/broadcast.js";
import { runStage2 } from "./stage2Design.js";

/** JSON schema handed to `claude -p --json-schema` for one domain's research brief. */
export const RESEARCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    domain: { type: "string" },
    key_apis: { type: "array", items: { type: "string" } },
    idioms: { type: "array", items: { type: "string" } },
    gotchas: { type: "array", items: { type: "string" } },
    version_notes: { type: "string" },
    sources: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, url: { type: "string" } },
        required: ["title", "url"],
      },
    },
  },
  required: ["domain", "key_apis", "idioms", "gotchas", "version_notes", "sources"],
} as const;

const BriefSchema = z.object({
  domain: z.string(),
  key_apis: z.array(z.string()),
  idioms: z.array(z.string()),
  gotchas: z.array(z.string()),
  version_notes: z.string().min(1),
  sources: z
    .array(z.object({ title: z.string(), url: z.string() }))
    .min(2),
});

export function researchPrompt(
  targetStack: string,
  domain: string,
  answers: Record<string, string | string[]> | undefined,
): string {
  const answerLines = answers
    ? Object.entries(answers)
        .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("\n")
    : "(none)";
  return [
    `You are researching the knowledge domain "${domain}" for the stack: ${targetStack}.`,
    "Use your web tools to find AUTHORITATIVE, PRIMARY sources (official docs, release notes).",
    "Capture VERSIONED facts, common idioms, the canonical APIs, and the pitfalls that bite developers.",
    "Cite at least two real sources you actually read; never invent URLs, APIs, or versions.",
    "",
    "EFFICIENCY (does not lower the bar on the brief, only avoids wasted tokens):",
    "- Lead with WebSearch and rely on result snippets; only WebFetch a page when a snippet is insufficient to confirm a fact.",
    "- WebFetch at most 3 pages total — pick the most authoritative ones rather than fetching broadly.",
    "- From each fetched page, extract ONLY the specific facts you need; do not re-read or restate whole pages.",
    "",
    "Clarified scope answers:",
    answerLines,
    "",
    "Return ONLY the structured fields: domain, key_apis, idioms, gotchas, version_notes, sources.",
  ].join("\n");
}

/** Derive the research domains from the answered scope (fall back to the stack itself). */
export function deriveDomains(domains: string[] | undefined, targetStack: string): string[] {
  const list = (domains ?? []).map((d) => d.trim()).filter(Boolean);
  // de-dupe by slug so two domains never collide on the same research file
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const d of list) {
    const s = slug(d);
    if (!seen.has(s)) {
      seen.add(s);
      unique.push(d);
    }
  }
  return unique.length > 0 ? unique : [targetStack];
}

function initialResearch(domains: string[]): ResearchState {
  return {
    status: "running",
    domains: domains.map<ResearchDomainState>((domain) => ({
      domain,
      slug: slug(domain),
      status: "pending",
    })),
  };
}

/**
 * Stage 1 — intensive research. One parallel `claude -p` call per knowledge domain
 * (bounded by the shared concurrency semaphore + per-job ceiling + daily budget),
 * each producing a versioned, cited brief persisted to research/<slug>.json. One
 * domain failing never aborts the others; partial briefs are always kept on disk.
 */
export async function runStage1(ctx: AppContext, jobId: string): Promise<void> {
  const job = await ctx.jobStore.get(jobId);
  if (!job || !job.scope) return; // nothing to research without an answered scope

  const domains = deriveDomains(job.scope.domains, job.scope.targetStack);
  const answers = job.scope.answers;
  const targetStack = job.scope.targetStack;

  await ctx.jobStore.update(jobId, (j) => {
    j.research = initialResearch(domains);
    const stage = j.stages.find((s) => s.key === "research");
    if (stage) {
      stage.status = "running";
      stage.startedAt = new Date().toISOString();
    }
    j.status = "active";
  });
  await emit(ctx, jobId, "stage", { stageKey: "research", status: "running" });
  for (const d of domains) {
    await emit(ctx, jobId, "research", { domain: d, status: "pending" });
  }

  const tools = toolsFor(ctx.config, "research");

  await Promise.allSettled(
    domains.map((domain) => researchOneDomain(ctx, jobId, targetStack, domain, answers, tools)),
  );

  // Compute the final stage status from the per-domain outcomes.
  const finished = await ctx.jobStore.update(jobId, (j) => {
    const states = j.research?.domains ?? [];
    const anyDone = states.some((d) => d.status === "done");
    const anyFailed = states.some((d) => d.status === "failed");
    const status: ResearchState["status"] = !anyDone
      ? "failed"
      : anyFailed
        ? "done_with_warnings"
        : "done";
    if (j.research) j.research.status = status;
    const stage = j.stages.find((s) => s.key === "research");
    if (stage) {
      stage.status = status === "failed" ? "failed" : "done";
      stage.endedAt = new Date().toISOString();
      if (status === "done_with_warnings") {
        stage.error = "some domains failed; partial briefs saved";
      }
    }
    if (status === "failed") j.status = "failed";
  });

  await emit(ctx, jobId, "stage", {
    stageKey: "research",
    status: finished.research?.status === "failed" ? "failed" : "done",
  });
  await emitJob(ctx, finished);

  // Advance the pipeline into Stage 2 design (unless research wholly failed).
  if (finished.research?.status !== "failed") void runStage2(ctx, jobId);
}

async function researchOneDomain(
  ctx: AppContext,
  jobId: string,
  targetStack: string,
  domain: string,
  answers: Record<string, string | string[]> | undefined,
  tools: string[],
): Promise<void> {
  const callId = `research-${slug(domain)}`;

  // Respect the per-job invocation ceiling before spending another call.
  const current = await ctx.jobStore.get(jobId);
  if (current && ceilingReached(current.meter)) {
    await markDomain(ctx, jobId, domain, "failed", "per-job invocation ceiling reached");
    return;
  }

  // A persisted sessionId means a prior attempt already started this domain's
  // research; resume it so the agentic web-research loop continues instead of
  // restarting. A fresh domain gets a new id that we persist BEFORE spawning, so
  // even an immediate interruption leaves something to resume from.
  const existing = current?.research?.domains.find((d) => d.domain === domain);
  const sessionId = existing?.sessionId ?? randomUUID();
  const resuming = Boolean(existing?.sessionId);

  await markDomainRunning(ctx, jobId, domain, sessionId);

  try {
    const callOnce = (resume: boolean) =>
      ctx.claude.structured({
        prompt: researchPrompt(targetStack, domain, answers),
        jsonSchema: RESEARCH_JSON_SCHEMA,
        tools, // research-stage tools ONLY (WebSearch/WebFetch — no Bash, no shell exec)
        cwd: ctx.jobStore.dir(jobId),
        sessionId,
        resume,
        onRaw: (chunk) => void ctx.jobStore.appendRaw(jobId, callId, chunk),
        onAttempt: (attempt, maxRetries, delayMs, reason) =>
          ctx.sse.broadcast(jobId, "retry", { domain, attempt, maxRetries, delayMs, reason }),
      });

    // If resuming a stale/missing session fails, fall back to a clean fresh run
    // (a brand-new session id) — never worse than the old always-start-over path.
    let res;
    if (resuming) {
      try {
        res = await callOnce(true);
      } catch {
        const freshId = randomUUID();
        await markDomainRunning(ctx, jobId, domain, freshId);
        res = await ctx.claude.structured({
          prompt: researchPrompt(targetStack, domain, answers),
          jsonSchema: RESEARCH_JSON_SCHEMA,
          tools,
          cwd: ctx.jobStore.dir(jobId),
          sessionId: freshId,
          resume: false,
          onRaw: (chunk) => void ctx.jobStore.appendRaw(jobId, callId, chunk),
          onAttempt: (attempt, maxRetries, delayMs, reason) =>
            ctx.sse.broadcast(jobId, "retry", { domain, attempt, maxRetries, delayMs, reason }),
        });
      }
    } else {
      res = await callOnce(false);
    }

    const brief: ResearchBrief = { ...BriefSchema.parse(res.structuredOutput), domain };
    await ctx.jobStore.writeBrief(jobId, domain, brief);

    const updated = await ctx.jobStore.update(jobId, (j) => {
      j.meter = applyResult(j.meter, res.info);
      j.meter.ceilingHit = ceilingReached(j.meter);
      const ds = j.research?.domains.find((d) => d.domain === domain);
      if (ds) {
        ds.status = "done";
        ds.summary = {
          keyApis: brief.key_apis.length,
          gotchas: brief.gotchas.length,
          sources: brief.sources.length,
        };
      }
    });
    await emit(ctx, jobId, "meter", updated.meter);
    await emit(ctx, jobId, "research", {
      domain,
      status: "done",
      summary: updated.research?.domains.find((d) => d.domain === domain)?.summary,
    });
  } catch (err) {
    await markDomain(ctx, jobId, domain, "failed", err instanceof Error ? err.message : String(err));
  }
}

/** Mark a domain running and persist its session id (so an interruption is resumable). */
async function markDomainRunning(
  ctx: AppContext,
  jobId: string,
  domain: string,
  sessionId: string,
): Promise<void> {
  await ctx.jobStore.update(jobId, (j) => {
    const ds = j.research?.domains.find((d) => d.domain === domain);
    if (ds) {
      ds.status = "running";
      ds.sessionId = sessionId;
      ds.error = undefined;
    }
  });
  await emit(ctx, jobId, "research", { domain, status: "running" });
}

async function markDomain(
  ctx: AppContext,
  jobId: string,
  domain: string,
  status: ResearchDomainState["status"],
  error?: string,
): Promise<void> {
  await ctx.jobStore.update(jobId, (j) => {
    const ds = j.research?.domains.find((d) => d.domain === domain);
    if (ds) {
      ds.status = status;
      if (error) ds.error = error;
    }
  });
  await emit(ctx, jobId, "research", { domain, status, ...(error ? { error } : {}) });
}

/**
 * Resume Stage 1 — incremental research. Unlike `runStage1` which resets all
 * domains, this only re-researches domains that do NOT already have a brief on
 * disk (research/<slug>.json). Completed domains are left untouched and their
 * existing meter contributions are preserved.
 */
export async function resumeStage1(ctx: AppContext, jobId: string): Promise<void> {
  const job = await ctx.jobStore.get(jobId);
  if (!job || !job.scope) return;

  const domains = deriveDomains(job.scope.domains, job.scope.targetStack);
  const answers = job.scope.answers;
  const targetStack = job.scope.targetStack;

  // Determine which domains already have a brief on disk.
  const pendingDomains: string[] = [];
  const doneDomains: ResearchDomainState[] = [];
  for (const domain of domains) {
    const exists = await ctx.jobStore.hasBrief(jobId, domain);
    if (exists) {
      // Preserve existing state from job.json if available, otherwise mark done.
      const existing = job.research?.domains.find((d) => d.domain === domain);
      doneDomains.push(existing ?? { domain, slug: slug(domain), status: "done" });
    } else {
      pendingDomains.push(domain);
    }
  }

  // If everything is already done, just advance to Stage 2.
  if (pendingDomains.length === 0) {
    await ctx.jobStore.update(jobId, (j) => {
      if (j.research) j.research.status = "done";
      const stage = j.stages.find((s) => s.key === "research");
      if (stage) {
        stage.status = "done";
        stage.endedAt = new Date().toISOString();
      }
      j.status = "active";
    });
    await emit(ctx, jobId, "stage", { stageKey: "research", status: "done" });
    void runStage2(ctx, jobId);
    return;
  }

  // Build merged research state: done domains stay done, pending ones are reset.
  const mergedDomains: ResearchDomainState[] = domains.map((domain) => {
    const done = doneDomains.find((d) => d.domain === domain);
    if (done) return { ...done, status: "done" as const };
    return { domain, slug: slug(domain), status: "pending" as const };
  });

  await ctx.jobStore.update(jobId, (j) => {
    j.research = { status: "running", domains: mergedDomains };
    const stage = j.stages.find((s) => s.key === "research");
    if (stage) {
      stage.status = "running";
      stage.startedAt = stage.startedAt ?? new Date().toISOString();
      stage.error = undefined;
    }
    j.status = "active";
  });
  await emit(ctx, jobId, "stage", { stageKey: "research", status: "running" });
  for (const d of mergedDomains) {
    await emit(ctx, jobId, "research", {
      domain: d.domain,
      status: d.status,
      ...(d.summary ? { summary: d.summary } : {}),
    });
  }

  const tools = toolsFor(ctx.config, "research");

  // Only launch research for domains that need it.
  await Promise.allSettled(
    pendingDomains.map((domain) =>
      researchOneDomain(ctx, jobId, targetStack, domain, answers, tools),
    ),
  );

  // Compute the final stage status from all domain outcomes.
  const finished = await ctx.jobStore.update(jobId, (j) => {
    const states = j.research?.domains ?? [];
    const anyDone = states.some((d) => d.status === "done");
    const anyFailed = states.some((d) => d.status === "failed");
    const status: ResearchState["status"] = !anyDone
      ? "failed"
      : anyFailed
        ? "done_with_warnings"
        : "done";
    if (j.research) j.research.status = status;
    const stage = j.stages.find((s) => s.key === "research");
    if (stage) {
      stage.status = status === "failed" ? "failed" : "done";
      stage.endedAt = new Date().toISOString();
      if (status === "done_with_warnings") {
        stage.error = "some domains failed; partial briefs saved";
      }
    }
    if (status === "failed") j.status = "failed";
  });

  await emit(ctx, jobId, "stage", {
    stageKey: "research",
    status: finished.research?.status === "failed" ? "failed" : "done",
  });
  await emitJob(ctx, finished);

  if (finished.research?.status !== "failed") void runStage2(ctx, jobId);
}
