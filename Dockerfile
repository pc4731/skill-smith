# Skill Smith backend (orchestrator + API + SSE).
#
# The backend shells out to the `claude` CLI at runtime, so the image installs
# the Claude Code CLI. Authentication is NOT baked in — provide ANTHROPIC_API_KEY
# at run time and run with SKILL_SMITH_BARE=true (bare mode uses the API key).
#
# Build:  docker build -t skill-smith-backend .
# Run:    docker run -p 4000:4000 -e ANTHROPIC_API_KEY=sk-... -e SKILL_SMITH_BARE=true \
#                 -v "$PWD/workspace:/app/workspace" skill-smith-backend

# ---- deps: install workspace dependencies against the lockfile ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

# ---- runtime ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The Claude Code CLI is the engine. Pin via build arg if you need a specific version.
ARG CLAUDE_CLI_PKG="@anthropic-ai/claude-code"
RUN npm install -g ${CLAUDE_CLI_PKG} && claude --version || true

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY package.json package-lock.json skill-smith.config.json ./
COPY backend ./backend
# workspace/ is a runtime volume; ensure it exists and is writable by the node user
RUN mkdir -p /app/workspace && chown -R node:node /app/workspace

USER node
EXPOSE 4000
ENV PORT=4000
CMD ["npm", "--workspace", "backend", "run", "start"]
