# Deploying Skill Smith

Skill Smith has two pieces:

- **backend** — the orchestrator (Express API + SSE) that shells out to the `claude` CLI.
- **web** — the static React bundle, served by nginx, which reverse-proxies `/api` to the backend.

> **The `claude` CLI is a hard runtime dependency of the backend.** It must be installed *and
> authenticated* wherever the backend runs. The backend image installs the Claude Code CLI; you
> supply auth at run time via `ANTHROPIC_API_KEY` and `SKILL_SMITH_BARE=true` (bare mode reads the
> key directly). Secrets are never baked into the image.

## Local (no containers) — the primary supported flow

See [RUN.md](RUN.md). In short: `npm install` then `npm run dev` (backend on `:4000`, frontend on
`:5173` with a dev proxy to the backend).

## Docker Compose

```bash
cp .env.example .env          # set ANTHROPIC_API_KEY
ANTHROPIC_API_KEY=sk-... docker compose up --build
# open http://localhost:8080   (web → nginx → backend:4000)
```

- `backend` service: built from `Dockerfile`, runs `npm -w backend run start`, listens on `:4000`,
  has a `/api/health` healthcheck, and mounts `./workspace` so job artifacts persist across restarts.
- `web` service: built from `Dockerfile.frontend`, serves the Vite bundle on `:8080` and proxies
  `/api` (with SSE buffering disabled) to the `backend` service.

## Building images individually

```bash
docker build -t skill-smith-backend .
docker build -f Dockerfile.frontend -t skill-smith-web .
```

## Configuration

All knobs live in `skill-smith.config.json` and are overridable by env (see `.env.example` and the
table in [README.md](README.md)). The important ones for a deploy:

| Env | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | CLI auth (with `SKILL_SMITH_BARE=true`). |
| `SKILL_SMITH_MODEL` | Engine model (default `claude-opus-4-8`). |
| `SKILL_SMITH_MAX_PARALLELISM` / `SKILL_SMITH_INVOCATION_CEILING` | Cost guardrails. |
| `PORT` | Backend port (default 4000). |

## CI

`.github/workflows/ci.yml` runs on push/PR: `npm ci` → `npm run typecheck` → `npm run build` →
`npm test`. The test suite mocks the `claude` CLI, so CI needs no API key and incurs no cost.
