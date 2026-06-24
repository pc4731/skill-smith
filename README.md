# Skill Smith

Turn a one-line project description (e.g. *"AEM project with React"*, *"Spring Boot REST + SOAP + SQL"*)
into a **complete, tested set of [Claude Agent Skills](https://code.claude.com/docs/en/skills)** — with
zero manual skill-hunting.

Skill Smith uses **Claude Code itself as its engine**: every research, generation, and verification step
shells out to the `claude` CLI in headless mode (`claude -p`). The web app is a thin orchestration +
live-display layer over that engine.

> **All 6 phases are complete.** The full pipeline runs end-to-end and the project is feature-complete
> (see [`.project/phases.md`](.project/phases.md)).

## The pipeline (6 stages)

A job streams live through six stages; everything is persisted on disk so a refresh or restart never
loses progress:

0. **Scope / intake** — a scoping call decomposes your one-line description into a target stack,
   knowledge domains, and up to 5 clarifying questions (answer them, or **Use defaults**).
1. **Research** — one `claude -p` agent per domain (with `WebSearch`/`WebFetch`) writes a versioned,
   cited brief (`research/<domain>.json`).
2. **Design** — proposes a skill-set plan (one domain per skill, split by variant) and **parks for your
   approval** (approve or edit).
3. **Generation** — writes each skill directory (`SKILL.md` + `references/` + optional `scripts/`) and
   deterministically validates it.
4. **Self-test** *(the differentiator)* — measures each skill's **trigger reliability** (rewriting the
   description until it clears the threshold) and **capability** (runs a representative task with the
   skill loaded and grades it), iterating back to generation on failure (capped). Writes
   `skills/<slug>/report.json`.
5. **Package + results** — validates + **safety-scans** each skill, zips it to a `.skill`, and presents a
   results screen (trigger rate, capability score, SKILL.md preview, sources, **Download .skill** /
   **Download all**, install hints).

## Prerequisites

- **Node.js ≥ 20** (developed on Node 22).
- The **Claude Code CLI** installed and authenticated — verify with `claude --version`. Skill Smith spawns
  `claude -p` under the hood. (Bare-mode runs need `ANTHROPIC_API_KEY`; normal runs use your CLI login.)
- Network access (used by the research stage).

## Quick start

```bash
npm install        # installs backend + frontend workspaces
npm run dev         # starts the backend (API + SSE) and the frontend (Vite) together
npm test            # runs the backend test suite (mocks the claude CLI — no API calls, no cost)
```

Open the printed frontend URL, type a project description, answer the Stage-0 questions (or click
**Use defaults**), and watch the live pipeline.

## Configuration

All runtime settings live in [`skill-smith.config.json`](skill-smith.config.json); each is overridable
by an environment variable. (The file is strict JSON, so this table — mirroring the zod schema in
`backend/src/config/config.ts` — is the authoritative field reference.)

| Setting | Env var | Default | Purpose |
| --- | --- | --- | --- |
| `model` | `SKILL_SMITH_MODEL` | `claude-opus-4-8` | Engine model for `claude -p`. `""` = CLI default. |
| `bare` | `SKILL_SMITH_BARE` | `false` | Pass `--bare` (needs `ANTHROPIC_API_KEY`). |
| `claudeBin` | `SKILL_SMITH_CLAUDE_BIN` | `claude` | CLI binary (tests point this at a mock). |
| `workspaceDir` | `SKILL_SMITH_WORKSPACE_DIR` | `./workspace` | Per-job artifact root. |
| `host` | `SKILL_SMITH_HOST` | `127.0.0.1` | Bind interface. Localhost by default; `0.0.0.0` only behind a proxy/auth. |
| `maxParallelism` | `SKILL_SMITH_MAX_PARALLELISM` | `3` | Max concurrent claude invocations. |
| `perJobInvocationCeiling` | `SKILL_SMITH_INVOCATION_CEILING` | `150` | Hard per-job invocation cap (Stage 4 is invocation-heavy). |
| `globalDailyInvocationCeiling` | `SKILL_SMITH_DAILY_INVOCATION_CEILING` | `0` | Process-wide claude calls/day (0 = unlimited). |
| `maxDescriptionLength` | `SKILL_SMITH_MAX_DESCRIPTION_LENGTH` | `4000` | Max project-description length (chars). |
| `selfTest.triggerThreshold` | `SKILL_SMITH_TRIGGER_THRESHOLD` | `0.8` | Min trigger rate a skill must clear in Stage 4. |
| `selfTest.trials` | `SKILL_SMITH_SELFTEST_TRIALS` | `3` | Judge runs per trigger prompt. |
| `selfTest.maxIterations` | `SKILL_SMITH_SELFTEST_MAX_ITERATIONS` | `3` | Cap on rewrite/re-generate self-test iterations. |
| `selfTest.evalLabel` | `SKILL_SMITH_SELFTEST_EVAL_LABEL` | `false` | Test-only: reveal the expected answer to the judge. **Keep `false` in production.** |
| `retry.maxRetries` | `SKILL_SMITH_RETRY_MAX` | `3` | Retry attempts for retryable failures. |
| `retry.baseDelayMs` | `SKILL_SMITH_RETRY_BASE_DELAY_MS` | `1000` | Backoff base. |
| `retry.maxDelayMs` | `SKILL_SMITH_RETRY_MAX_DELAY_MS` | `30000` | Backoff cap. |

`toolPermissions` is set per stage: `WebSearch`/`WebFetch` are granted **only** to research; generation
and self-test get `Read`/`Write`/`Edit`; scope and design get none.

## History & re-run

Every job is listed (newest-first) on the **History** screen (`GET /api/jobs` returns compact
summaries — description, status, skill count, est. cost). Open any past job to review it, or click
**Re-run** (`POST /api/jobs/:id/rerun`) to start a fresh job from the same description (carrying the
answered scope so it skips the clarifier); the original is never modified.

Because the in-memory stage runners don't survive a process restart, on boot Skill Smith **reconciles
orphans**: any job left mid-stage is marked `failed` (so the UI shows a real outcome, not a perpetual
spinner) — parked jobs awaiting your input/approval are left resumable.

## Example job

A complete, browsable sample run is committed at
[`workspace/examples/example-spring-boot/`](workspace/examples/example-spring-boot/) (generated with the
mock engine, no secrets): `job.json`, `scope.json`, `research/`, `plan.json`, `skills/<slug>/` +
`.skill`, and `results.json`. It's a static reference, not a live job.

## Security posture

- Binds to **localhost** by default; the cost-incurring API is not exposed on all interfaces.
- **No `Bash` and no web access** in any Claude-invoking stage except research (`WebSearch`/`WebFetch`);
  all artifact paths are slug-confined within the job dir.
- Generated `scripts/` are **never executed** by Skill Smith, and Stage 5 **safety-scans** every skill
  (rejecting secrets / `curl … | sh`-style patterns) before packaging.
- Secrets (`ANTHROPIC_API_KEY`) are never logged, streamed to the browser, or written into prompts.
- See [DEPLOY.md](DEPLOY.md) for the SSRF (research) and filesystem-sandbox (generation/capability) notes.

## Limitations

- The **Claude Code CLI must be installed + authenticated** at runtime (it's the engine). Tests mock it.
- A server restart **fails** any in-flight job (no mid-stage resume) — re-run it from History.
- **No auth / rate-limiting** yet: run it locally, or put it behind a proxy with auth before exposing it.

## How job state is stored

Everything is on disk under `workspace/<jobId>/`, so a browser refresh (or a server restart) never loses
a job:

```
workspace/<jobId>/
  job.json         # authoritative job + stage status + cost meter
  events.ndjson    # append-only stream of pipeline + claude events
  scope.json       # written when Stage 0 is answered
  research/<domain>.json  # Stage 1: one versioned, cited research brief per domain
  plan.json        # Stage 2: the approved skill-set plan
  skills/<slug>/   # Stage 3: one generated skill (SKILL.md + references/ + optional scripts/)
  skills/<slug>/report.json  # Stage 4: that skill's self-test report (trigger rate, capability score, pass/fail)
  skills/<slug>.skill  # Stage 5: the packaged skill (zip); all-skills.zip bundles them; results.json holds per-skill results
  raw/<callId>.ndjson  # raw claude output per invocation (for debugging / partial recovery)
```

See [RUN.md](RUN.md) for exact install/build/run/test steps.
