# Skill Smith — Project Brief

## Overview
Skill Smith turns a one-line project description (e.g. "AEM project with React") into a complete, tested set of **Claude Agent Skills** (SKILL.md folders), using the **Claude Code CLI (`claude -p`, headless) as its engine** — every stage shells out to `claude`; the web app is a thin orchestration + live-display layer. For developers who want stack-expert skills without manual skill-hunting. Built **phased**; this brief reflects **Phases 1–2 complete**.

## Phased roadmap status (.project/phases.md)
- [x] **Phase 1 — Foundation + Stage 0 (DONE)**: scaffold, `claude -p` wrapper, job store, SSE, cost guardrails, Stage-0 intake/clarifier.
- [x] **Phase 2 — Stage 1 research (DONE)**: parallel per-domain `claude -p` research (WebSearch/WebFetch) → versioned cited briefs at workspace/<job>/research/<slug>.json; live research cards.
- [ ] Phase 3 — Stage 2-3 skill design + generation (approve gate; write workspace/<job>/skills/<name>/).
- [ ] Phase 4 — Stage 4 self-test loop (trigger-rate optimizer + capability grading, iterate-on-fail).
- [ ] Phase 5 — Stage 5 package + results screen (validate/zip/.skill, install hints).
- [ ] Phase 6 — Polish: history, cost-meter refinement, resume, example fixture.
Mode autonomous. NOTE: in the prior run the orchestrator STOPped after phase 1 without auto-advancing; phase 1 had to be marked [x] in phases.md by hand before `orchestrate_phases build=true` would pick phase 2. Watch for the same at each boundary.

## Architecture
npm-workspaces monorepo. **backend** (Express+TS) orchestrator: spawns `claude -p` via child_process, parses newline-delimited stream-json, persists all state to disk under `workspace/<jobId>/`, pushes live updates over **SSE**. **frontend** (React+Vite+TS) is a thin, refresh-safe view: seeds from `GET /api/jobs/:id` then subscribes to SSE; holds no unrecoverable state. Pipeline = 6 stages (Scope→Research→Design→Generate→Test→Package); **Scope (Stage 0) + Research (Stage 1) implemented**; a Stage-as-background-runtime pattern (runStageN(ctx,jobId)) is the seam for later stages.

## Tech stack
Node ≥20 (dev 22), TypeScript strict. Backend: Express 4, zod 3, run via tsx; tests vitest 2 + supertest. Frontend: React 18, Vite 5, react-router-dom 6; tests vitest + @testing-library/react (jsdom). Engine: external **`claude` CLI** (installed+authed, or ANTHROPIC_API_KEY + bare mode). Default model **claude-opus-4-8** (env-overridable). No DB — disk JSON only. SSE (not WebSocket).

## Module / file map
- `skill-smith.config.json` → inline-documented config (model, bare, claudeBin, host, workspaceDir, maxParallelism, perJobInvocationCeiling, globalDailyInvocationCeiling, maxDescriptionLength, retry, toolPermissions). Every field env-overridable (SKILL_SMITH_*).
- `backend/src/config/config.ts` → zod schema + file→env overlay→freeze; `toolsFor(stage)`. **toolPermissions.research = [WebSearch, WebFetch] ONLY** (Bash/Read removed for security); scope/others [].
- `backend/src/claude/{streamParser,events,claudeClient}.ts` → defensive stream-json parser; ClaudeEvent union + NON_RETRYABLE_ERRORS; the wrapper: `stream()` (stream-json) + `structured()` (json + --json-schema), args-ARRAY spawn (no shell), retry/backoff, consults Semaphore + GlobalBudget, appends raw to raw/<callId>.ndjson.
- `backend/src/meter/costMeter.ts` → per-job meter + ceiling. `util/semaphore.ts` (global concurrency), `util/globalBudget.ts` (per-UTC-day cap, 0=unlimited).
- `backend/src/jobs/jobPaths.ts` → job-id validation + workspace confinement; **slug()** + **researchFile()** (Stage 1, sanitized path). `jobs/jobStore.ts` → atomic temp+rename writes, **per-job update MUTEX (runExclusive)** so parallel updates don't clobber, writeScope/writeBrief/appendEvent/appendRaw/list/get/update. `jobs/types.ts` → Job/Stage/Meter/Scope + **ResearchBrief/ResearchSource/ResearchDomainState/ResearchState (Job.research)**.
- `backend/src/sse/sseHub.ts` → per-job subscribers + bounded replay buffer + heartbeat.
- `backend/src/stages/stage0Scope.ts` → runStage0 (scoping→questions, awaiting_input) + applyAnswers (writes scope.json, marks done, then **void runStage1** — scope→research auto-transition). SCOPE_JSON_SCHEMA.
- `backend/src/stages/stage1Research.ts` → **RESEARCH_JSON_SCHEMA + zod BriefSchema (version_notes + >=2 sources), researchPrompt(), deriveDomains() (scope.domains||[targetStack], slug-deduped), runStage1()**: Promise.allSettled per domain through ctx.claude.structured() with research tools, zod-validate→writeBrief→per-domain status+summary+meter+SSE; final stage done/done_with_warnings/failed.
- `backend/src/routes/index.ts` → POST /api/jobs, /say-hi, GET /api/jobs[/:id][/stream], POST /api/jobs/:id/answers, **POST /api/jobs/:id/research (re-trigger; 202; 404/409 guards)**, GET /api/health, /api/budget.
- `backend/src/{context,server,index}.ts` → AppContext (config, jobStore, sse, claude, budget); createApp(); listen on config.host (default 127.0.0.1).
- Frontend: `state/jobReducer.ts` (+ 'research' action upsert-by-domain), `hooks/useJobStream.ts` (SSE incl. 'research'), `components/ResearchCards.tsx` (per-domain cards, aria-live), `components/{TopBar,PromptBar,Stepper,StreamingConsole,CostMeter,Clarifier}.tsx`, `screens/{Intake,Run,History}Screen.tsx`, `theme/*`, `types.ts` (mirrors backend incl. ResearchState).
- Ops: Dockerfile (backend+CLI, non-root), Dockerfile.frontend+nginx.conf, docker-compose.yml (backend SKILL_SMITH_HOST=0.0.0.0, port unpublished; web :8080), .github/workflows/ci.yml, .env.example, RUN.md, DEPLOY.md (incl. **SSRF note for Stage 1 WebFetch**).

## Key decisions & trade-offs
- Claude CLI as engine (stateless calls; each stage reads prior artifacts from disk and passes them forward).
- stream-json parsed defensively (ignore unknown types); cost/usage from the `result` event.
- Disk is source of truth (job.json authoritative + atomic; events.ndjson replayable) → refresh/restart-safe.
- Cost guardrails first-class: per-job ceiling + global parallelism semaphore + opt-in per-day ceiling + max description length.
- Security: web tools confined to research; **research tools = WebSearch/WebFetch only (no Bash)** so an untrusted-content-ingesting agent has no shell; slug-sanitized brief paths; static briefs (no live-fetch baked into later artifacts); localhost bind by default; args-array spawn; secrets never logged/sent to browser. SSRF via model-driven WebFetch is inherent — documented; sandbox egress for untrusted/public use.
- Stage 1 runs per domain in parallel via Promise.allSettled bounded by the shared semaphore; partial failures → done_with_warnings (others kept). A concurrent-update race (parallel jobStore.update) was fixed with a per-job mutex.
- Tests mock the `claude` CLI via SKILL_SMITH_CLAUDE_BIN → backend/test/fixtures/fake-claude.mjs (scope mode, research-brief mode, FAIL_DOMAIN hook, retry/nonretryable). Deterministic, no API cost.

## Data model (disk, per job)
`workspace/<jobId>/`: `job.json` {id,kind,status,description,stages[6]{key,status},scope?,questions?,answers?,**research?{status:pending|running|done|done_with_warnings|failed, domains:[{domain,slug,status,error?,summary?{keyApis,gotchas,sources}}]}**,meter}; `events.ndjson` (SSE/event log); `scope.json`; **`research/<slug>.json`** {domain,key_apis[],idioms[],gotchas[],version_notes,sources[>=2 {title,url}]}; `raw/<callId>.ndjson`.

## Build / run / test (see RUN.md)
- `npm install` → `npm run dev` (backend 127.0.0.1:4000 + frontend :5173 with /api proxy; open :5173). Answering Stage 0 auto-starts Stage 1 research; cards stream live.
- `npm test` → backend (vitest+supertest) + frontend (vitest+RTL), all mock the CLI. `npm run typecheck`, `npm run build`. Docker: `ANTHROPIC_API_KEY=… docker compose up --build` → :8080.
- Status: **59 tests green** (backend 43 / frontend 16), tsc clean, vite build green; Stage 1 runtime-verified live (8/8 checks with mock CLI: scope→research auto-advance, briefs on disk, stepper done, re-trigger 202).

## Gotchas & TODOs
- The `claude` CLI is a hard runtime dependency of the backend; tests/CI don't need it.
- Backend runs via tsx (no compiled dist); build = `tsc --noEmit` typecheck only.
- Stage 1 LOW items (open, polish-phase): per-job ceiling is best-effort under parallelism (overshoot up to maxParallelism-1 — GlobalBudget is the hard cap); failed-domain attempts aren't metered for cost; cosmetic frontend ResearchDomainState.slug = display name on SSE-append.
- Earlier LOW items still open: sayHi/stage0/stage1 failure-path duplication; events.ndjson write errors swallowed in broadcast.emit; jobStore.list() sequential I/O. Security MEDIUM/LOW before public exposure: add auth + rate limit (currently bounded by ceilings), keep localhost bind, sandbox research egress (SSRF).
- Stages 3-6 NOT built. Extend via the Stage-runtime seam + per-stage toolPermissions + disk-artifact pattern: Stage 2-3 reads research/*.json → writes skills/<name>/.