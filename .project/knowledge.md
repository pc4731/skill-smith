# Skill Smith — Project Brief

## Overview
Skill Smith turns a one-line project description into a tested set of **Claude Agent Skills**, using the **Claude Code CLI (`claude -p`, headless) as its engine**. Thin orchestration + live web app over that engine. Built **phased**; **Phases 1–3 complete**.

## Phased roadmap (.project/phases.md)
- [x] Phase 1 — Foundation + Stage 0 intake/clarifier.
- [x] Phase 2 — Stage 1 research: parallel per-domain `claude -p` (WebSearch/WebFetch) → versioned cited briefs at research/<slug>.json.
- [x] Phase 3 — Stage 2 design (skill-set plan + approve gate → plan.json) + Stage 3 generation (writes skills/<slug>/ with deterministic ground-truth validation).
- [ ] Phase 4 — Stage 4 self-test (trigger-rate optimizer + capability grading). [ ] Phase 5 — Stage 5 package + results screen. [ ] Phase 6 — polish/history/fixtures.
Mode autonomous; the auto-advance between phases now works (research→design cascades; phases roll forward). If a phase ever STOPs without advancing, mark it [x] in phases.md before `orchestrate_phases build=true`.

## Architecture
npm-workspaces monorepo. backend (Express+TS) spawns `claude -p` via child_process, parses stream-json, persists all state under workspace/<jobId>/, streams over SSE. frontend (React+Vite+TS) seeds from GET /api/jobs/:id then subscribes to SSE; holds no unrecoverable state. Pipeline 6 stages; **Scope(0)+Research(1)+Design(2)+Generate(3) implemented**; runStageN(ctx,jobId) background-runtime pattern is the seam. Auto-advance: applyAnswers→runStage1; stage1 done→runStage2 (parks for approval); approve→runStage3.

## Tech stack
Node ≥20 (dev 22), TS strict. Backend Express 4 + zod 3, run via tsx; vitest 2 + supertest. Frontend React 18 + Vite 5 + react-router-dom 6; vitest + RTL (jsdom). Engine = external `claude` CLI (or ANTHROPIC_API_KEY + bare). Default model claude-opus-4-8 (env-overridable). No DB — disk JSON. SSE.

## Module / file map
- skill-smith.config.json → config; toolPermissions: scope/design [], **research = [WebSearch,WebFetch]**, **generate = [Read,Write,Edit]** (NO Bash anywhere; no web outside research).
- backend/src/claude/{streamParser,events,claudeClient}.ts → defensive stream-json; wrapper stream()/structured(), args-array spawn, retry, Semaphore + GlobalBudget.
- backend/src/jobs/jobPaths.ts (slug() + researchFile/planFile/skillsDir/skillDir, all slug-confined); jobStore.ts (atomic writes, per-job update MUTEX runExclusive, writeScope/writeBrief/writePlan); types.ts (+ Research*, **SkillPlanItem/DesignState/GeneratedSkill/GenerationState**, job.research/design/generation).
- backend/src/stages/: stage0Scope.ts (runStage0 + applyAnswers→runStage1); stage1Research.ts (RESEARCH_JSON_SCHEMA, runStage1; on done→runStage2); **stage2Design.ts** (PLAN_JSON_SCHEMA, designPrompt, readBriefs, runStage2 → design.status=awaiting_approval + job awaiting_input; applyPlan(approve|edit)→writePlan+runStage3); **stage3Generate.ts** (generationPrompt, deterministic validateSkill(dir) [hand-parses frontmatter: name+description present, description<=1536, body<=500 non-blank lines, references/ present], runStage3: Promise.allSettled per skill, claude.stream() with generate tools writes skills/<slug>/, validate, per-skill 'skill'/'meter' SSE; done/done_with_warnings/failed).
- backend/src/routes/index.ts → POST /api/jobs, /say-hi, GET /api/jobs[/:id][/stream], POST /api/jobs/:id/answers, /research, **/plan (approve|edit, 404/409 guards, 202)**, GET /api/health, /budget. context/server/index.ts (listen on config.host default 127.0.0.1).
- Frontend: state/jobReducer.ts (+ 'research'/'design'/'skill' actions), hooks/useJobStream.ts (those SSE events), components/{ResearchCards,SkillPlan,SkillCards}.tsx, RunScreen mounts SkillPlan (awaiting_approval) + SkillCards; api.ts approvePlan(); types.ts mirrors all stage state.
- Ops: Dockerfile(+CLI, non-root), Dockerfile.frontend+nginx.conf, docker-compose.yml, ci.yml, .env.example, RUN.md, DEPLOY.md (Stage-1 SSRF + Stage-3 FS-sandbox notes). .verify/probe*.mjs runtime probes.

## Key decisions
Claude CLI engine (stateless; each stage reads prior artifacts from disk, passes forward). stream-json parsed defensively; cost from result event. Disk = source of truth (atomic job.json + replayable events.ndjson) → refresh/restart-safe. Cost guardrails first-class (per-job ceiling + parallelism semaphore + per-day ceiling + max description length + skill-count cap). Security: per-stage tools — web ONLY in research, NO Bash anywhere (research and generate had Bash removed: prompt-injection->RCE), generation gets Read/Write/Edit; all artifact paths slug-confined; generated scripts/ are inert (never executed); secrets never in prompts/SSE; localhost bind; args-array spawn; SSRF (research WebFetch) + FS-write (generation) risks documented — sandbox for untrusted/public use. Design parks for human approval before generation. Deterministic validateSkill enforces ground-truth rules (not the LLM). Parallel stages bounded by the shared semaphore; partial fail → done_with_warnings; concurrent-update race fixed with per-job mutex. Tests mock the CLI via SKILL_SMITH_CLAUDE_BIN → fake-claude.mjs (scope/research/design/generation/FAIL_DOMAIN/FAIL_SKILL/retry modes).

## Data model (disk, per job)
workspace/<jobId>/: job.json {..., research?, **design?{status:pending|running|awaiting_approval|done|failed, skills:[{name,slug,description,scopeBoundaries,sourceDomains[]}]}, generation?{status:pending|running|done|done_with_warnings|failed, skills:[{name,slug,status,error?,validation?{ok,descriptionChars,bodyLines,hasReferences,issues[]}}]}**, meter}; events.ndjson; scope.json; research/<slug>.json; **plan.json {skills:[...]}**; **skills/<slug>/ (SKILL.md frontmatter name+description + lean body, references/*.md, optional scripts/)**; raw/<callId>.ndjson.

## Build/run/test
npm install → npm run dev (backend 127.0.0.1:4000 + frontend :5173). Answer Stage 0 → research → design parks for approval → click Approve → generation writes skills. npm test (mocks CLI), npm run typecheck, npm run build. Docker compose → :8080. Status: **71 tests green** (backend 51 / frontend 20), tsc clean, build green; Stage 2-3 runtime-verified live 9/9 (full pipeline to valid SKILL.md on disk).

## Gotchas & TODOs
claude CLI is a backend runtime dependency (not for tests/CI). Backend runs via tsx (no dist; build = tsc --noEmit). Stage 2-3 LOW (polish): validateSkill hand-parses single-line frontmatter (multi-line YAML desc would mis-measure — add 'yaml' dep if needed); body counted as non-blank lines; best-effort per-job ceiling under parallelism + unmetered failed attempts (same as stage1); minor brief-formatting duplication + stage3 dynamic-imports readBriefs (could extract stages/briefs.ts). Carryover LOW: failure-path duplication across stages, swallowed events.ndjson write errors, sequential jobStore.list(). Security pre-public: add auth + rate limit (bounded by ceilings), keep localhost bind, sandbox research egress + generation FS writes, scan generated scripts at packaging. Stages 4-6 NOT built — Stage 4 grades skills (trigger reliability + capability), Stage 5 packages + results screen, Stage 6 polish/history/fixtures; extend via the Stage-runtime seam reading prior on-disk artifacts.