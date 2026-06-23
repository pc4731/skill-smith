# RUN.md — install, run, and test Skill Smith

Skill Smith is an npm-workspaces monorepo: a **Node + Express + TypeScript** backend (the orchestrator
that shells out to the `claude` CLI and streams over SSE) and a **React + Vite + TypeScript** frontend.

> **Phase status:** **Phases 1–2 are done.** Live: the `claude -p` wrapper, job store, SSE, cost meter,
> the Stage-0 scoping/clarifier flow, and **Stage 1 research** (parallel per-domain research → versioned
> briefs). **Stages 3–6 (Design → Generate → Self-test → Package → polish) are not implemented yet** and
> appear as *pending* in the UI stepper. See [`.project/phases.md`](.project/phases.md).

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

## 5. Where job artifacts land

Everything is persisted on disk under `workspace/<jobId>/`, so a browser refresh or a server restart
re-attaches to a job with no loss:

```
workspace/<jobId>/
  job.json            # authoritative job + stage status + cost meter
  events.ndjson       # append-only stream of pipeline + claude events (SSE replay source)
  scope.json          # written when Stage 0 is answered
  research/<slug>.json # Stage 1: one versioned, cited brief per knowledge domain
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
| `perJobInvocationCeiling` | `SKILL_SMITH_INVOCATION_CEILING` | `40` | Hard per-job invocation cap. |
| `globalDailyInvocationCeiling` | `SKILL_SMITH_DAILY_INVOCATION_CEILING` | `0` | Process-wide claude calls/day (`0` = unlimited). |
| `maxDescriptionLength` | `SKILL_SMITH_MAX_DESCRIPTION_LENGTH` | `4000` | Max project-description length. |
| `retry.maxRetries` | `SKILL_SMITH_RETRY_MAX` | `3` | Retry attempts for retryable failures. |
| `retry.baseDelayMs` | `SKILL_SMITH_RETRY_BASE_DELAY_MS` | `1000` | Backoff base (ms). |
| `toolPermissions.<stage>` | — | research-only web | Per-stage `--allowed-tools`. Only the research stage gets `WebSearch`/`WebFetch`. |
| `PORT` | `PORT` / `SKILL_SMITH_PORT` | `4000` | Backend port. |

## 8. Containers / deploy

See [DEPLOY.md](DEPLOY.md) for Docker, docker-compose, and CI. Note: the `claude` CLI must be present
and authenticated wherever the backend runs.
