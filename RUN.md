# RUN.md — install, run, and test Skill Smith

Skill Smith is an npm-workspaces monorepo: a **Node + Express + TypeScript** backend (the orchestrator
that shells out to the `claude` CLI and streams over SSE) and a **React + Vite + TypeScript** frontend.

> **Phase status:** **Phases 1–5 are done.** Live: the `claude -p` wrapper, job store, SSE, cost meter,
> Stage-0 scoping/clarifier, **Stage 1 research**, **Stage 2 design** (plan + approve gate), **Stage 3
> generation** (writes each skill directory), **Stage 4 self-test** (trigger reliability + capability
> grading, with iterate-on-failure), and **Stage 5 package + results** (validate + safety-scan + zip each
> skill to a `.skill`, then a results screen with downloads). **Stage 6 (polish/history/fixtures) is not
> implemented yet.** See [`.project/phases.md`](.project/phases.md).

## 1. Prerequisites

- **Node.js ≥ 20** (developed and tested on Node 22). Check: `node --version`.
- **The Claude Code CLI, installed and authenticated.** Skill Smith spawns `claude -p` as its engine.
  - Check it is present: `claude --version`
  - It must be logged in (interactive `claude` login) **or** have `ANTHROPIC_API_KEY` set when run in
    bare mode (`SKILL_SMITH_BARE=true`).
- **Network access** — only needed by the research stage in a later phase; not required for Phase 1.

> You do **not** need the claude CLI or any API key to run the **tests** — they mock the CLI (see §6).

## 2. Install

```bash
npm install        # installs both workspaces (backend + frontend) from the lockfile
```

## 3. Run (development)

A single command starts the backend and the frontend together:

```bash
npm run dev
```

- **Backend** → `http://127.0.0.1:4000` (API + SSE). Binds to localhost by default.
- **Frontend** → `http://localhost:5173` (Vite dev server; proxies `/api` to the backend).

Open **http://localhost:5173**.

To run just one side:

```bash
npm run dev:backend     # backend only (tsx watch)
npm run dev:frontend    # frontend only (vite)
```

## 4. Exercise the two Phase-1 flows

### a) `claude -p "say hi"` round-trip (proves the engine works end-to-end)

In the UI, click **“Test connection (say hi)”** on the home screen. You’ll be taken to `/job/:id` and
the streamed output appears live in the console panel; the cost meter records calls/tokens/$.

Or from the API directly:

```bash
curl -s -X POST http://127.0.0.1:4000/api/say-hi      # -> {"id":"<jobId>"}
curl -s http://127.0.0.1:4000/api/jobs/<jobId>         # poll: status becomes "done", meter.calls >= 1
```

### b) Stage 0 — intake & clarification

1. Type a project description (e.g. *"AEM project with React"*) in the prompt bar and submit.
2. The backend runs a scoping `claude -p --output-format json --json-schema` call and returns up to
   ~5 questions, rendered as selectable chips.
3. Answer them and click **Submit answers**, or click **Use defaults**.
4. The answered scope is written to `workspace/<jobId>/scope.json` and Stage 0 is marked done, which
   **auto-advances the job into Stage 1 research**.

### c) Stage 1 — research

Once Stage 0 is answered, the backend kicks off research automatically: one `claude -p` call **per
knowledge domain** from the scope, run in parallel (bounded by `maxParallelism`) with the
research-stage web tools (**`WebSearch` + `WebFetch`** only — no shell). Each domain produces a
versioned, cited brief written to `workspace/<jobId>/research/<slug>.json`:

```json
{ "domain": "...", "key_apis": ["..."], "idioms": ["..."], "gotchas": ["..."],
  "version_notes": "...", "sources": [{ "title": "...", "url": "..." }, { "title": "...", "url": "..." }] }
```

Per-domain status (and a compact summary) streams live to the UI research cards; a compact summary is
also kept in `job.json` under `research`. If a domain fails, the others continue and the stage ends
`done_with_warnings`. (Stages 3–6 remain pending.)

API equivalent:

```bash
curl -s -X POST http://127.0.0.1:4000/api/jobs \
  -H 'content-type: application/json' \
  -d '{"description":"AEM project with React"}'        # -> {"id":"<jobId>"}

# After status is "awaiting_input", answer (or use defaults) — this auto-starts research:
curl -s -X POST http://127.0.0.1:4000/api/jobs/<jobId>/answers \
  -H 'content-type: application/json' \
  -d '{"useDefaults":true}'

# Re-run research for an already-answered job (202; 409 if scope unanswered or research running):
curl -s -X POST http://127.0.0.1:4000/api/jobs/<jobId>/research
```

### d) Stage 2 — design (skill-set plan + approve gate)

When research finishes, the backend proposes a **skill-set plan** (one-domain-per-skill, split by
variant, with load-bearing "pushy" descriptions) and **parks for your approval** (`design.status =
awaiting_approval`). In the UI, review the proposed skills and click **Approve & generate**.

```bash
# After research is done the job parks awaiting plan approval; approve it (or pass edited skills[]):
curl -s -X POST http://127.0.0.1:4000/api/jobs/<jobId>/plan \
  -H 'content-type: application/json' -d '{"approve":true}'
# -> 202; writes plan.json and auto-starts generation. 409 if no plan awaiting / generation running.
```

### e) Stage 3 — generation

After approval, Skill Smith generates **one directory per skill** under
`workspace/<jobId>/skills/<slug>/` — `SKILL.md` (YAML frontmatter `name`+`description` + a lean body),
`references/*.md` (heavy detail), and `scripts/` only where a deterministic helper beats prose. The
generation engine uses **`Read`/`Write`/`Edit`** tools only (no Bash, no web). Each skill is then
**deterministically validated** against the ground-truth rules: frontmatter `name`+`description`
present, `description` ≤ 1536 chars, a lean body, and `references/` present. A skill that fails
validation is kept for inspection and the stage ends `done_with_warnings`. Per-skill status streams to
the UI skill cards.

### f) Stage 4 — self-test (the differentiator)

After generation, each skill is **self-tested** automatically:

- **Trigger reliability:** Skill Smith generates realistic prompts that *should* and *should not* load
  the skill, then a fresh judge (given only the skills' name+description) decides which it would load,
  over `selfTest.trials` runs. If the trigger rate is under `selfTest.triggerThreshold`, the description
  is **rewritten and re-tested** (capped by `selfTest.maxIterations`).
- **Capability grading:** a fresh agent runs a representative task **with the skill loaded** (using the
  test tools `Read`/`Write`/`Edit` — no Bash, no web), and a separate grader scores the output 0–1
  against assertions derived from the research briefs.
- A skill passes when its trigger rate clears the threshold **and** the capability grade passes. On
  failure (with iterations left) Skill Smith **re-generates the skill with the grader's feedback** and
  re-tests. Results land in `workspace/<job>/skills/<slug>/report.json` and stream to the UI self-test
  cards; the stage ends `done`/`done_with_warnings`/`failed`.

### g) Stage 5 — package + results (the deliverable)

After self-test, each skill is **packaged and delivered**. This stage is **deterministic** — it makes
**no `claude` calls** (no API cost / no budget use). Per skill:

- **Validate** the skill structurally (re-runs the Stage-3 `validateSkill`), then **safety-scan** its
  files — a skill is shipped to and potentially run by a user, so any file containing a hardcoded
  secret or an obvious shell-exfiltration/obfuscation pattern (e.g. `curl … | sh`) is **rejected, not
  shipped**.
- **Package** the skill directory into `workspace/<job>/skills/<slug>.skill` (a zip — uses
  skill-creator's `package_skill.py` if present, otherwise a plain zip via the `archiver` dependency),
  excluding internals (`.cap/`, `report.json`). All passing skills are also bundled into
  `workspace/<job>/all-skills.zip`.
- **Assemble** `workspace/<job>/results.json` (+ `job.results`): per-skill pass/fail, trigger rate,
  capability score, cited **sources** (from the skill's research briefs), and **install hints**
  (personal `~/.claude/skills/<slug>/` vs project `.claude/skills/<slug>/`).

A skill that fails validation or the safety scan is marked `failed` and excluded; the stage ends
`done`/`done_with_warnings`/`failed`, and the **job completes** (`status: done`). The **Results screen**
shows one card per skill (pass/fail, trigger rate, capability score, a collapsible SKILL.md preview,
sources, a **Download .skill** button, install hints) plus a **Download all** button, served by:

- `GET /api/jobs/:id/skills/:slug/SKILL.md` — the skill's SKILL.md (preview text)
- `GET /api/jobs/:id/skills/:slug/package` — the `.skill` archive
- `GET /api/jobs/:id/download-all` — the combined zip

(Stage 6 — polish/history/fixtures — remains pending.)

## 5. Where job artifacts land

Everything is persisted on disk under `workspace/<jobId>/`, so a browser refresh or a server restart
re-attaches to a job with no loss:

```
workspace/<jobId>/
  job.json            # authoritative job + stage status + cost meter
  events.ndjson       # append-only stream of pipeline + claude events (SSE replay source)
  scope.json          # written when Stage 0 is answered
  research/<slug>.json # Stage 1: one versioned, cited brief per knowledge domain
  plan.json           # Stage 2: the approved skill-set plan
  skills/<slug>/      # Stage 3: one generated skill (SKILL.md + references/ + optional scripts/)
  skills/<slug>/report.json  # Stage 4: that skill's self-test report (trigger rate, capability score, pass/fail)
  skills/<slug>.skill # Stage 5: the packaged skill (a zip), excluding internals
  all-skills.zip      # Stage 5: all delivered skills bundled ('Download all')
  results.json        # Stage 5: assembled per-skill results (scores, sources, install hints)
  raw/<callId>.ndjson # raw claude output per invocation (debugging / partial recovery)
```

## 6. Test

```bash
npm test            # backend (vitest) + frontend (vitest) — both mock the claude CLI
```

- Run one side: `npm -w backend run test` or `npm -w frontend run test`.
- Type-check everything: `npm run typecheck`.
- Production build (type-check + Vite bundle): `npm run build`.

The backend tests inject a fake `claude` binary via `SKILL_SMITH_CLAUDE_BIN` (see
`backend/test/fixtures/fake-claude.mjs`), so the suite is deterministic and **never calls the paid
API**. The frontend tests use a fake `fetch` + `EventSource`.

## 7. Configuration

All knobs live in [`skill-smith.config.json`](skill-smith.config.json) (documented inline) and each is
overridable by an environment variable. Copy [`.env.example`](.env.example) to `.env` to set them.

| Setting | Env var | Default | Purpose |
| --- | --- | --- | --- |
| `model` | `SKILL_SMITH_MODEL` | `claude-opus-4-8` | Engine model for `claude -p`. `""` = CLI default. |
| `bare` | `SKILL_SMITH_BARE` | `false` | Pass `--bare` (needs `ANTHROPIC_API_KEY`). |
| `claudeBin` | `SKILL_SMITH_CLAUDE_BIN` | `claude` | CLI binary (tests point this at a mock). |
| `host` | `SKILL_SMITH_HOST` | `127.0.0.1` | Bind interface. `0.0.0.0` only behind a proxy/auth. |
| `workspaceDir` | `SKILL_SMITH_WORKSPACE_DIR` | `./workspace` | Per-job artifact root. |
| `maxParallelism` | `SKILL_SMITH_MAX_PARALLELISM` | `3` | Max concurrent claude invocations. |
| `perJobInvocationCeiling` | `SKILL_SMITH_INVOCATION_CEILING` | `150` | Hard per-job invocation cap (raised for the invocation-heavy Stage 4). |
| `selfTest.triggerThreshold` | `SKILL_SMITH_TRIGGER_THRESHOLD` | `0.8` | Min trigger rate a skill must clear in Stage 4. |
| `selfTest.trials` | `SKILL_SMITH_SELFTEST_TRIALS` | `3` | Judge runs per trigger prompt. |
| `selfTest.maxIterations` | `SKILL_SMITH_SELFTEST_MAX_ITERATIONS` | `3` | Cap on rewrite/re-generate self-test iterations. |
| `globalDailyInvocationCeiling` | `SKILL_SMITH_DAILY_INVOCATION_CEILING` | `0` | Process-wide claude calls/day (`0` = unlimited). |
| `maxDescriptionLength` | `SKILL_SMITH_MAX_DESCRIPTION_LENGTH` | `4000` | Max project-description length. |
| `retry.maxRetries` | `SKILL_SMITH_RETRY_MAX` | `3` | Retry attempts for retryable failures. |
| `retry.baseDelayMs` | `SKILL_SMITH_RETRY_BASE_DELAY_MS` | `1000` | Backoff base (ms). |
| `toolPermissions.<stage>` | — | research-only web | Per-stage `--allowed-tools`. Only the research stage gets `WebSearch`/`WebFetch`. |
| `PORT` | `PORT` / `SKILL_SMITH_PORT` | `4000` | Backend port. |

## 8. Containers / deploy

See [DEPLOY.md](DEPLOY.md) for Docker, docker-compose, and CI. Note: the `claude` CLI must be present
and authenticated wherever the backend runs.
