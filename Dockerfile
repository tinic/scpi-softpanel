# syntax=docker/dockerfile:1

# ---- build stage: install deps and build the web bundle ----
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable

# Install with maximal layer caching: manifests first, then sources.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @scpi/web build

# ---- runtime stage: node + python bridge ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    BRIDGE_PYTHON=/app/bridge/.venv/bin/python

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

# Bring over the installed workspace (incl. node_modules + built web/dist).
COPY --from=build /app /app

# Create the bridge venv after copying app so it is not clobbered.
RUN python3 -m venv /app/bridge/.venv \
    && /app/bridge/.venv/bin/pip install --no-cache-dir -r bridge/requirements.txt

EXPOSE 8080
CMD ["pnpm", "--filter", "@scpi/server", "start"]
