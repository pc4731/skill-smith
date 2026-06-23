# Skill Smith — Project Brief

## Overview
Skill Smith turns a one-line project description (e.g. "AEM project with React") into a complete, tested set of **Claude Agent Skills** (SKILL.md folders). It uses the **Claude Code CLI (`claude -p`, headless) as its engine** — every research/generation/verification step shells out to `claude`; the web app is a thin orchestration + live-display layer. For developers who want stack-expert skills without manual skill-hunting. Built **phased**; this brief reflects **Phase 1 complete**.

## Phased roadmap status (.project/phases.md)
- [x] **Phase 1 — Foundation + Stage 0 (DONE)**: scaffold, `claude -p` wrapper, job store, SSE, cost guardrails, Stage-0 intake/clarifier end-to-end.
- [ ] Phase 2 — Stage 1 research (parallel per-domain `claude -p` agents w/ WebSearch/WebFetch → versioned briefs at workspace/<job>/research/<domain>.json).
- [ ] Phase 3 — Stage 2-3 skill design + generation (approve gate; write workspace/<job>/skills/<name>/).
- [ ] Phase 4 — Stage 4 self-test loop (trigger-rate optimizer + capability grading, iterate-on-fail).
- [ ] Phase 5 — Stage 5 package + results screen (validate/zip/.skill, install hints).
- [ ] Phase 6 — Polish: history, cost-meter refinement, resume, example fixture.
Advance mode is **autonomous** (roadmap rolls through all phases).

## Architecture
npm-workspaces monorepo. **backend** (Express+TS) is the orchestrator: it spawns `claude -p` via child_process, parses newline-delimited stream-json, persists all state to disk under `workspace/<jobId>/`, and pushes live updates to the browser over **SSE**. **frontend** (React+Vite+TS) is a thin, refresh-safe view: it seeds from `GET /api/jobs/:id` then subscribes to the SSE stream; it holds no unrecoverable state. The pipeline is modeled as 6 stages (Scope→Research→Design→Generate→Test→Package); only **Scope (Stage 0)** is implemented; a `Stage` interface seam lets later stages slot in.

## Tech stack
- Node ≥20 (dev on 22), TypeScript strict. Backend: Express 4, zod 3, run via tsx; tests vitest 2 + supertest. Frontend: React 18, Vite 5, react-router-dom 6; tests vitest + @testing-library/react (jsdom).
- Engine: the external **`claude` CLI** (must be installed + authenticated; or `ANTHROPIC_API_KEY` with bare mode). Default model **claude-opus-4-8** (env-overridable).
- No database — disk JSON only. SSE (not WebSocket) for one-way live streaming.

## Module / file map
- `skill-smith.config.json` → inline-documented runtime config (model, bare, claudeBin, host, workspaceDir, maxParallelism, perJobInvocationCeiling, globalDailyInvocationCeiling, maxDescriptionLength, retry, toolPermissions). Every field env-overridable (SKILL_SMITH_*).
- `backend/src/config/config.ts` → zod schema + file→env overlay→freeze; `toolsFor(stage)` (web tools ONLY for `research`).
- `backend/src/claude/streamParser.ts` → incremental stream-json parser (cross-chunk buffer; ignores unknown/non-JSON lines).
- `backend/src/claude/events.ts` → ClaudeEvent union + NON_RETRYABLE_ERRORS set; classifyEvent().
- `backend/src/claude/claudeClient.ts` → the wrapper. `stream()` (stream-json) + `structured()` (json + --json-schema). spawns with an **args ARRAY (no shell)**; retry-with-backoff (retryable vs non-retryable); consults the daily budget + parallelism semaphore; appends raw output to raw/<callId>.ndjson.
- `backend/src/meter/costMeter.ts` → per-job meter (calls/tokens/$ from result events) + ceiling check.
- `backend/src/util/semaphore.ts` → global concurrency cap; `util/globalBudget.ts` → process-wide per-UTC-day invocation cap (0=unlimited).
- `backend/src/jobs/jobPaths.ts` → job-id validation + workspace-confinement (path-traversal guard). `jobs/jobStore.ts` → atomic (temp+rename) job.json writes, events.ndjson/scope.json/raw appends, list/get/update. `jobs/types.ts` → Job/Stage/Meter/Scope shapes.
- `backend/src/sse/sseHub.ts` → per-job subscriber set + bounded replay buffer + heartbeat.
- `backend/src/stages/stage0Scope.ts` → `runStage0` (scoping call → questions, parks awaiting_input) + `applyAnswers` (answers|useDefaults → writes scope.json, marks done, does NOT advance). `SCOPE_JSON_SCHEMA` here.
- `backend/src/runtime/{broadcast,sayHi}.ts` → emit-to-SSE+persist helper; the say-hi round-trip runtime.
- `backend/src/routes/index.ts` → POST /api/jobs, POST /api/say-hi, GET /api/jobs[/:id][/stream], POST /api/jobs/:id/answers, GET /api/health, GET /api/budget.
- `backend/src/{context,server,index}.ts` → AppContext wiring (config, jobStore, sse, claude, budget); createApp(); listen on config.host (default 127.0.0.1).
- `frontend/src/theme/{tokens.json,applyTokens.ts,ThemeProvider.tsx}` → dark-default design tokens → CSS vars.
- `frontend/src/state/jobReducer.ts` + `hooks/useJobStream.ts` → SSE event reducer; seed-from-GET-then-EventSource (refresh-safety).
- `frontend/src/components/{TopBar,PromptBar,Stepper,StreamingConsole,Clarifier,CostMeter}.tsx`, `screens/{Intake,Run,History}Screen.tsx`, `App.tsx`, `api.ts`, `types.ts`.
- Ops: `Dockerfile` (backend+CLI, non-root), `Dockerfile.frontend`+`nginx.conf` (static+/api proxy, SSE buffering off), `docker-compose.yml` (backend SKILL_SMITH_HOST=0.0.0.0, port unpublished; web :8080), `.github/workflows/ci.yml`, `.env.example`, `RUN.md`, `DEPLOY.md`.

## Key decisions & trade-offs
- **Claude CLI as engine** (not the API SDK): reuses the user's auth + tools; calls are stateless, so each stage reads prior artifacts from disk and passes them forward.
- **stream-json parsed defensively**: switch on known type (system/assistant/stream_event/result/api_retry), ignore unknown — survives CLI version drift. Cost/usage taken from the `result` event.
- **Disk is the source of truth** (job.json authoritative, atomic writes; events.ndjson replayable): browser refresh / server restart never loses a job. SSE buffer is a cache.
- **Cost guardrails are first-class**: per-job invocation ceiling + global parallelism semaphore + opt-in per-day global ceiling + max description length; web tools confined to the research stage.
- **Stage 0 implemented during the scaffold task** so the server was runnable end-to-end (the dedicated Stage-0 task then added focused tests).
- **Localhost bind by default** + args-array spawn + job-id confinement = no command injection / path traversal; secrets never logged or sent to the browser (security review: no CRITICAL/HIGH).
- Tests **mock the `claude` CLI** via `SKILL_SMITH_CLAUDE_BIN` → `backend/test/fixtures/fake-claude.mjs` (deterministic, no API cost).

## Data model (disk, per job)
`workspace/<jobId>/`: `job.json` {id,kind(skill|sayhi),status(active|awaiting_input|done|failed),description,stages[6]{key,status},scope?,questions?,answers?,meter{calls,inputTokens,outputTokens,totalCostUsd,ceiling,ceilingHit}}, `events.ndjson` (append-only SSE/event log), `scope.json` (written on answer: {targetStack,domains[],likelyTasks[],questions[],answers,usedDefaults}), `raw/<callId>.ndjson` (raw claude output per invocation).

## Build / run / test (see RUN.md)
- `npm install` → `npm run dev` (backend 127.0.0.1:4000 + frontend :5173 with /api proxy; open :5173).
- `npm test` → backend (vitest+supertest) + frontend (vitest+RTL), all mock the CLI. `npm run typecheck`, `npm run build`. Docker: `ANTHROPIC_API_KEY=… docker compose up --build` → http://localhost:8080.
- Status: **49 tests green** (backend 37 / frontend 12), tsc clean, vite build green; runtime-verified live (10/10 API checks + frontend serves) with the mock CLI.

## Gotchas & TODOs
- The `claude` CLI is a hard runtime dependency of the backend (install + auth, or ANTHROPIC_API_KEY + SKILL_SMITH_BARE=true). Tests/CI don't need it.
- Backend dev/run uses **tsx** (no compiled dist); build script is `tsc --noEmit` (typecheck only). A compiled artifact is deferred.
- Code-review LOW items still open for the polish phase: failure-path duplication between sayHi/stage0 (extract shared helper), events.ndjson write errors are logged-not-fatal (currently swallowed in broadcast.emit), jobStore.list() is sequential I/O (parallelize/paginate when history grows), some `any` typing in useJobStream. (Dead `baseArgs` already removed.)
- Security MEDIUM/LOW before any public exposure: add auth + keep localhost bind (0.0.0.0 only behind proxy), set a daily invocation ceiling, trim error-message verbosity. Dev-only dep vulns (vite/vitest) — bump when convenient; not shipped.
- Stages 1-5 are NOT built — they are the next phases; the `Stage` interface + per-stage toolPermissions + disk-artifact pattern are the seams to extend.