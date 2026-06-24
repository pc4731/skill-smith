# Skill Smith — Project Brief

## Overview
Skill Smith turns a one-line project description into a tested set of **Claude Agent Skills**, using the **Claude Code CLI (`claude -p`, headless) as its engine**. Thin orchestration + live-display web app over that engine. Built **phased**; **Phases 1–2 complete**.

## Phased roadmap (.project/phases.md)
- [x] Phase 1 — Foundation + Stage 0 intake/clarifier.
- [x] Phase 2 — Stage 1 research: parallel per-domain `claude -p` (WebSearch/WebFetch) → versioned cited briefs at workspace/<job>/research/<slug>.json; live research cards.
- [ ] Phase 3 — Stage 2-3 design + generation. [ ] Phase 4 — Stage 4 self-test. [ ] Phase 5 — Stage 5 package + results. [ ] Phase 6 — polish/history/fixtures.
Mode autonomous, BUT the orchestrator has STOPped after a phase without auto-advancing; mark the finished phase [x] in phases.md by hand before `orchestrate_phases build=true` picks the next.

## Architecture
npm-workspaces monorepo. backend (Express+TS) spawns `claude -p` via child_process, parses stream-json, persists all state under workspace/<jobId>/, streams over SSE. frontend (React+Vite+TS) seeds from GET /api/jobs/:id then subscribes to SSE; holds no unrecoverable state. Pipeline 6 stages; Scope (0) + Research (1) implemented; runStageN(ctx,jobId) background-runtime pattern is the seam.

## Tech stack
Node ≥20 (dev 22), TS strict. Backend Express 4 + zod 3, run via tsx; vitest 2 + supertest. Frontend React 18 + Vite 5 + react-router-dom 6; vitest + RTL (jsdom). Engine = external `claude` CLI (or ANTHROPIC_API_KEY + bare). Default model claude-opus-4-8 (env-overridable). No DB — disk JSON. SSE.

## Module / file map
- skill-smith.config.json → config; toolPermissions.research = [WebSearch, WebFetch] ONLY (Bash/Read removed); scope/others [].
- backend/src/claude/{streamParser,events,claudeClient}.ts → defensive stream-json; wrapper stream()/structured(), args-array spawn, retry, Semaphore + GlobalBudget, raw/<callId>.ndjson.
- backend/src/meter/costMeter.ts; util/semaphore.ts; util/globalBudget.ts.
- backend/src/jobs/jobPaths.ts (id validation + slug() + researchFile()); jobStore.ts (atomic writes, PER-JOB UPDATE MUTEX runExclusive, writeScope/writeBrief); types.ts (+ ResearchBrief/ResearchDomainState/ResearchState, Job.research).
- backend/src/sse/sseHub.ts.
- backend/src/stages/stage0Scope.ts (runStage0 + applyAnswers → void runStage1 auto-transition); stage1Research.ts (RESEARCH_JSON_SCHEMA, researchPrompt, deriveDomains, runStage1: Promise.allSettled per domain, zod-validate→writeBrief→status/summary/meter/SSE; done/done_with_warnings/failed).
- backend/src/routes/index.ts (+ POST /api/jobs/:id/research, 202/404/409). context/server/index.ts (listen on config.host default 127.0.0.1).
- Frontend: state/jobReducer.ts (+ 'research' upsert), hooks/useJobStream.ts (+ 'research' SSE), components/ResearchCards.tsx, RunScreen mounts it; types.ts mirrors ResearchState.
- Ops: Dockerfile(+CLI, non-root), Dockerfile.frontend+nginx.conf, docker-compose.yml, ci.yml, .env.example, RUN.md, DEPLOY.md (+ Stage-1 SSRF note).

## Key decisions
Claude CLI engine (stateless; stages read prior artifacts from disk). stream-json parsed defensively; cost from result event. Disk = source of truth (atomic job.json + replayable events.ndjson) → refresh/restart-safe. Cost guardrails first-class (per-job ceiling + parallelism semaphore + per-day ceiling + max description length). Security: research tools WebSearch/WebFetch ONLY (no Bash — no shell for an untrusted-content agent); slug-sanitized brief paths; static briefs; localhost bind; args-array spawn; no secret leakage; SSRF via WebFetch documented (sandbox egress for untrusted use). Stage 1 parallel via Promise.allSettled bounded by semaphore; partial fail → done_with_warnings; a concurrent-update race was fixed with the per-job mutex. Tests mock the CLI via SKILL_SMITH_CLAUDE_BIN → fake-claude.mjs (scope/research/FAIL_DOMAIN/retry modes).

## Data model (disk, per job)
workspace/<jobId>/: job.json {..., research?{status:pending|running|done|done_with_warnings|failed, domains:[{domain,slug,status,error?,summary?{keyApis,gotchas,sources}}]}, meter}; events.ndjson; scope.json; research/<slug>.json {domain,key_apis[],idioms[],gotchas[],version_notes,sources[>=2 {title,url}]}; raw/<callId>.ndjson.

## Build/run/test
npm install → npm run dev (backend 127.0.0.1:4000 + frontend :5173). Answering Stage 0 auto-starts Stage 1 research (cards stream). npm test (mocks CLI), npm run typecheck, npm run build. Docker compose → :8080. Status: 59 tests green (backend 43 / frontend 16), tsc clean, build green; Stage 1 runtime-verified live 8/8.

## Gotchas & TODOs
claude CLI is a backend runtime dependency (not for tests/CI). Backend runs via tsx (no dist; build = tsc --noEmit). Stage 1 LOW (polish): per-job ceiling best-effort under parallelism (GlobalBudget is hard cap); failed-domain attempts unmetered; cosmetic frontend slug on SSE-append. Older LOW: failure-path duplication, swallowed events.ndjson write errors, sequential jobStore.list(). Security MEDIUM/LOW pre-public: add auth + rate limit, keep localhost bind, sandbox research egress. Stages 3-6 NOT built — extend via Stage-runtime seam: Stage 2-3 reads research/*.json → writes skills/<name>/.