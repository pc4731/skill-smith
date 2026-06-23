# Skill Smith

Turn a one-line project description (e.g. *"AEM project with React"*, *"Spring Boot REST + SOAP + SQL"*)
into a **complete, tested set of [Claude Agent Skills](https://code.claude.com/docs/en/skills)** — with
zero manual skill-hunting.

Skill Smith uses **Claude Code itself as its engine**: every research, generation, and verification step
shells out to the `claude` CLI in headless mode (`claude -p`). The web app is a thin orchestration +
live-display layer over that engine.

> **Phased build.** This repository is being built in phases. **Phase 1 (current)** delivers the
> foundation + Stage 0 (intake & clarification). Stages 1–5 (research → design → generation → self-test →
> packaging) are tracked in [`.project/phases.md`](.project/phases.md) and land in later phases; the UI
> shows them as *pending*.

## Prerequisites

- **Node.js ≥ 20** (developed on Node 22).
- The **Claude Code CLI** installed and authenticated — verify with `claude --version`. Skill Smith spawns
  `claude -p` under the hood. (Bare-mode runs need `ANTHROPIC_API_KEY`; normal runs use your CLI login.)
- Network access (used by the research stage in a later phase).

## Quick start

```bash
npm install        # installs backend + frontend workspaces
npm run dev         # starts the backend (API + SSE) and the frontend (Vite) together
npm test            # runs the backend test suite (mocks the claude CLI — no API calls, no cost)
```

Open the printed frontend URL, type a project description, answer the Stage-0 questions (or click
**Use defaults**), and watch the live pipeline.

## Configuration

All runtime settings live in [`skill-smith.config.json`](skill-smith.config.json) (every field is
documented inline) and each is overridable by an environment variable:

| Setting | Env var | Default | Purpose |
| --- | --- | --- | --- |
| `model` | `SKILL_SMITH_MODEL` | `claude-opus-4-8` | Engine model for `claude -p`. `""` = CLI default. |
| `bare` | `SKILL_SMITH_BARE` | `false` | Pass `--bare` (needs `ANTHROPIC_API_KEY`). |
| `claudeBin` | `SKILL_SMITH_CLAUDE_BIN` | `claude` | CLI binary (tests point this at a mock). |
| `workspaceDir` | `SKILL_SMITH_WORKSPACE_DIR` | `./workspace` | Per-job artifact root. |
| `maxParallelism` | `SKILL_SMITH_MAX_PARALLELISM` | `3` | Max concurrent claude invocations. |
| `perJobInvocationCeiling` | `SKILL_SMITH_INVOCATION_CEILING` | `40` | Hard per-job invocation cap. |
| `retry.maxRetries` | `SKILL_SMITH_RETRY_MAX` | `3` | Retry attempts for retryable failures. |
| `retry.baseDelayMs` | `SKILL_SMITH_RETRY_BASE_DELAY_MS` | `1000` | Backoff base. |

Web tools (`WebSearch`/`WebFetch`) are granted **only** to the research stage.

## How job state is stored

Everything is on disk under `workspace/<jobId>/`, so a browser refresh (or a server restart) never loses
a job:

```
workspace/<jobId>/
  job.json         # authoritative job + stage status + cost meter
  events.ndjson    # append-only stream of pipeline + claude events
  scope.json       # written when Stage 0 is answered
  raw/<callId>.ndjson  # raw claude output per invocation (for debugging / partial recovery)
```

See [RUN.md](RUN.md) for exact install/build/run/test steps.
