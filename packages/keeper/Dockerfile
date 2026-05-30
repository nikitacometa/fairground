# Fairground keeper -- multi-stage pnpm monorepo build.
# Build context is the repo root (see docker-compose.yml: context: .).
# Two containers run from this image (primary + standby); they coordinate
# via a Redis SETNX leader lock, so only the holder resolves VRF sessions.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/types/package.json  packages/types/
COPY packages/db/package.json     packages/db/
COPY packages/sdk/package.json    packages/sdk/
COPY packages/keeper/package.json packages/keeper/
RUN pnpm install --frozen-lockfile --filter @fairground/keeper...

FROM deps AS build
COPY packages/types  packages/types
COPY packages/db     packages/db
COPY packages/sdk    packages/sdk
COPY packages/keeper packages/keeper
COPY tsconfig.base.json ./
RUN pnpm --filter @fairground/keeper... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/packages/keeper
CMD ["node", "dist/index.js"]
