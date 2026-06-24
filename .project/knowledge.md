# Skill Smith — Project Brief

## Overview
Skill Smith turns a one-line project description into a tested set of **Claude Agent Skills**, using the **Claude Code CLI (`claude -p`, headless) as its engine**. Thin orchestration + live web app over that engine. Built **phased**; **Phases 1–4 complete**.

## Phased roadmap (.project/phases.md)
- [x] Phase 1 — Foundation + Stage 0 intake/clarifier.
- [x] Phase 2 — Stage 1 research: parallel per-domain `claude -p` (WebSearch/WebFetch) → versioned cited briefs research/<slug>.json.
- [x] Phase 3 — Stage 2 design (skill-set plan + approve gate → plan.json) + Stage 3 generation (skills/<slug>/ + deterministic validateSkill).
- [x] Phase 4 — Stage 4 self-test (trigger-reliability optimizer + capability grading + iterate-on-failure → skills/<slug>/report.json).
- [ ] Phase 5 — Stage 5 package + results screen. [ ] Phase 6 — polish/history/fixtures.
Mode autonomous; phases auto-advance (scope→research→design[park for approval]→generate→self-test). If a phase ever STOPs without advancing, mark it [x] in phases.md before `orchestrate_phases build=true`.

## Architecture
npm-workspaces monorepo. backend (Express+TS) spawns `claude -p` via child_process, parses stream-json, persists all state under workspace/<jobId>/, streams over SSE. frontend (React+Vite+TS) seeds from GET /api/jobs/:id then subscribes to SSE; holds no unrecoverable state. Pipeline 6 stages; **Scope(0)+Research(1)+Design(2)+Generate(3)+SelfTest(4) implemented**; runStageN(ctx,jobId) background-runtime pattern is the seam.

## Tech stack
Node ≥20 (dev 22), TS strict. Backend Express 4 + zod 3, run via tsx; vitest 2 + supertest. Frontend React 18 + Vite 5 + react-router-dom 6; vitest + RTL (jsdom). Engine = external `claude` CLI (or ANTHROPIC_API_KEY + bare). Default model claude-opus-4-8. No DB — disk JSON. SSE.

## Module / file map
- skill-smith.config.json → config; toolPermissions: scope/design [], research=[WebSearch,WebFetch], generate=[Read,Write,Edit], **test=[Read,Write,Edit]** (NO Bash anywhere; web only in research). selfTest{triggerThreshold:0.8,trials:3,maxIterations:3,evalLabel:false}. perJobInvocationCeiling default 150 (Stage 4 is invocation-heavy).
- backend/src/claude/{streamParser,events,claudeClient}.ts → wrapper stream()/structured(), args-array spawn, retry, Semaphore + GlobalBudget.
- backend/src/jobs/jobPaths.ts (slug() + researchFile/planFile/skillsDir/skillDir/**reportFile**, slug-confined); jobStore.ts (atomic writes, per-job update MUTEX, writeScope/writeBrief/writePlan/**writeReport**); types.ts (Research*/Design*/Generation*/**SelfTest*** + job.research/design/generation/selftest).
- backend/src/stages/: stage0Scope.ts (runStage0 + applyAnswers→runStage1); stage1Research.ts (runStage1; done→runStage2); stage2Design.ts (runStage2 parks awaiting_approval; applyPlan→runStage3); stage3Generate.ts (runStage3 writes skills/<slug>/, validateSkill; exports **generateOne**; done→runStage4); **stage4SelfTest.ts** (TRIGGER_PROMPTS/JUDGE/GRADE/DESC schemas; runStage4: per generated-done skill — genPrompts → measureTrigger (judge over trials) → rewriteDescription+persist into SKILL.md if under threshold (capped) → capabilityGrade (run task with skill body inlined using TEST tools, then grader) → passed = triggerRate>=threshold && grade.passed; on fail re-run generateOne with feedback (capped); writes report.json + job.selftest; 'report'/'meter'/'stage' SSE).
- backend/src/routes/index.ts → POST /api/jobs, /say-hi, GET /api/jobs[/:id][/stream], POST /api/jobs/:id/answers, /research, /plan(approve|edit), GET /api/health, /budget. (No /retest route yet.)
- Frontend: state/jobReducer.ts (+ 'research'/'design'/'skill'/'report' upserts), hooks/useJobStream.ts (those SSE events), components/{ResearchCards,SkillPlan,SkillCards,SelfTestCards}.tsx, RunScreen mounts all; api.ts approvePlan(); types.ts mirrors all stage state.
- Ops: Dockerfile(+CLI, non-root), Dockerfile.frontend+nginx.conf, docker-compose.yml, ci.yml, .env.example, RUN.md, DEPLOY.md (Stage-1 SSRF + Stage-3/4 FS-sandbox + judge-eval-label notes). .verify/probe*.mjs runtime probes.

## Key decisions
Claude CLI engine (stateless; stages read prior artifacts from disk). Disk = source of truth (atomic job.json + replayable events.ndjson) → refresh/restart-safe. Cost guardrails (per-job ceiling 150 + parallelism semaphore + per-day ceiling + max description length + skill cap). Security: per-stage tools — web ONLY in research, NO Bash in any stage (prompt-injection->RCE); generation+test get Read/Write/Edit; all artifact paths slug-confined; generated scripts/ inert (never executed); secrets never in prompts/SSE; localhost bind; args-array spawn. Stage 4: the trigger JUDGE is shown ONLY name+description; the EVAL_EXPECT answer label is gated behind config.selfTest.evalLabel (default FALSE in prod, TRUE only for the mock test suite) so trigger measurement stays faithful. Capability check loads the skill by INLINING SKILL.md (no headless --skill flag). Deterministic validateSkill (not the LLM) enforces ground-truth rules. Parallel stages bounded by the semaphore; partial fail → done_with_warnings; concurrent-update race fixed with per-job mutex. Tests mock the CLI via SKILL_SMITH_CLAUDE_BIN → fake-claude.mjs (scope/research/design/generation/trigger-prompts/judge/grade/desc-rewrite/capability + FAIL_DOMAIN/FAIL_SKILL/lowtrig/lowcap hooks).

## Data model (disk, per job)
workspace/<jobId>/: job.json {..., research?, design?, generation?, **selftest?{status:pending|running|done|done_with_warnings|failed, skills:[{name,slug,status,triggerRate,falseTriggerRate,capabilityScore,passed,iterations,error?}]}**, meter}; events.ndjson; scope.json; research/<slug>.json; plan.json; skills/<slug>/ (SKILL.md + references/ + scripts/) + **report.json {triggerRate,falseTriggerRate,capabilityScore,passed,iterations,issues,prompts}**; raw/<callId>.ndjson.

## Build/run/test
npm install → npm run dev (backend 127.0.0.1:4000 + frontend :5173). Pipeline: answer Stage 0 → research → design parks → Approve → generation → self-test. npm test (mocks CLI), npm run typecheck, npm run build. Docker compose → :8080. Status: **79 tests green** (backend 56 / frontend 23), tsc clean, build green; Stage 4 runtime-verified live 6/6 (full pipeline to passing report.json).

## Gotchas & TODOs
claude CLI is a backend runtime dependency (not for tests/CI). Backend runs via tsx (no dist; build = tsc --noEmit). Stage 4 LOW (polish): run the capability task in an isolated skills/<slug>/.cap/ subdir so it can't pollute the delivered skill; single-line frontmatter assumption in validateSkill + rewrite; invocation-heaviness + unmetered failed calls (bounded by ceilings). Carryover LOW: failure-path duplication across stages, swallowed events.ndjson write errors, sequential jobStore.list(), brief-formatting duplication. Security pre-public: add auth + rate limit, keep localhost bind, sandbox research egress + generation/capability FS writes, scan generated scripts at packaging. Stages 5-6 NOT built — Stage 5 validates+packages each skill (skill-creator package_skill.py if present else zip to .skill) + a results screen (per-skill trigger rate + capability score + SKILL.md preview + sources + downloads + 'Download all' + install hints); Stage 6 polish/history/fixtures. Extend via the Stage-runtime seam reading prior on-disk artifacts (skills/<slug>/ + report.json).