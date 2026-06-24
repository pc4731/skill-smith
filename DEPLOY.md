# Deploying Skill Smith

Skill Smith has two pieces:

- **backend** — the orchestrator (Express API + SSE) that shells out to the `claude` CLI.
- **web** — the static React bundle, served by nginx, which reverse-proxies `/api` to the backend.

> **The `claude` CLI is a hard runtime dependency of the backend.** It must be installed *and
> authenticated* wherever the backend runs. The backend image installs the Claude Code CLI; you
> supply auth at run time via `ANTHROPIC_API_KEY` and `SKILL_SMITH_BARE=true` (bare mode reads the
> key directly). Secrets are never baked into the image.

## Local (no containers) — the primary supported flow

See [RUN.md](RUN.md). In short: `npm install` then `npm run dev` (backend API on `:4000`, frontend UI on
`:5174` with a dev proxy to the backend) — open the frontend (`:5174`), not the backend.

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

## Security note: Stage 1 web tools (SSRF)

Stage 1 research grants the engine **`WebSearch` + `WebFetch`** (and nothing else — no Bash/shell).
Because the model chooses which URLs to fetch, `WebFetch` is an inherent **SSRF** surface: it could be
steered toward internal endpoints (cloud metadata `169.254.169.254`, `localhost`, RFC1918 ranges). The
app cannot fully constrain this since the `claude` CLI performs the fetch. For any non-local or
multi-tenant deployment, run the backend in a **network-egress-restricted sandbox**: allowlist outbound
HTTP(S) and block link-local/metadata/RFC1918 destinations. Researched knowledge is persisted as static
files (`research/<domain>.json`); no fetched URL is re-fetched or executed by later stages.

## Security note: Stage 3 generation (filesystem writes)

Stage 3 generation grants the engine **`Read` + `Write` + `Edit`** (no Bash, no web) and runs each
generation with `cwd` set to the job's `skills/<slug>/` directory. Skill Smith's own slug-confinement
governs where it *reads/validates*, but the `claude` CLI performs the writes and its tool permissions
are coarse — a generation could in principle write outside the intended directory (absolute paths /
parent dirs). For any non-local or multi-tenant deployment, run the backend in a **filesystem-restricted
sandbox** (write access limited to the workspace/job directory). Generated `scripts/` are shipped as
data and are **never executed** by Skill Smith. The **Stage 4 capability check** has the same shape:
it runs an agent with the (model-generated) skill loaded and the same Read/Write/Edit tools, so apply
the same filesystem-restricted sandbox there. The trigger-reliability judge is never shown the expected
answer in production (`selfTest.evalLabel` defaults `false`; it is enabled only for the mocked test
suite), so the measured trigger rate is faithful.

## CI

`.github/workflows/ci.yml` runs on push/PR: `npm ci` → `npm run typecheck` → `npm run build` →
`npm test`. The test suite mocks the `claude` CLI, so CI needs no API key and incurs no cost.
