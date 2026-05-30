# Fairground API -- multi-stage pnpm monorepo build.
# Build context is the repo root (see docker-compose.yml: context: .).
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /app

# --- deps: install with the full workspace manifest set for cache efficiency ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/types/package.json   packages/types/
COPY packages/db/package.json      packages/db/
COPY packages/sdk/package.json     packages/sdk/
COPY packages/proof-card/package.json packages/proof-card/
COPY packages/api/package.json     packages/api/
RUN pnpm install --frozen-lockfile --filter @fairground/api...

# --- build: compile the api and its workspace deps ---
FROM deps AS build
COPY packages/types     packages/types
COPY packages/db        packages/db
COPY packages/sdk       packages/sdk
COPY packages/proof-card packages/proof-card
COPY packages/api       packages/api
COPY tsconfig.base.json ./
RUN pnpm --filter @fairground/api... build

# --- runtime: prod deps only ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/packages/api
EXPOSE 3010
CMD ["node", "dist/index.js"]
