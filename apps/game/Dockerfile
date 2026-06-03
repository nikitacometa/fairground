# Fairground game (Next.js) -- multi-stage pnpm monorepo build.
# Build context is the repo root (see docker-compose.yml: context: .).
# NEXT_PUBLIC_* values are inlined at build time, so they arrive as build args.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /app

# --- deps: install the game + its workspace deps ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/types/package.json packages/types/
COPY packages/sdk/package.json packages/sdk/
COPY packages/price-client/package.json packages/price-client/
COPY packages/nfd/package.json packages/nfd/
COPY apps/game/package.json apps/game/
RUN pnpm install --frozen-lockfile --filter @fairground/game...

# --- build: inline NEXT_PUBLIC_* then next build ---
FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ALGORAND_NETWORK
ARG NEXT_PUBLIC_COINFLIP_APP_ID
ARG NEXT_PUBLIC_MIN_BET_MICROALGO
ARG NEXT_PUBLIC_MAX_BET_MICROALGO
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_ALGORAND_NETWORK=$NEXT_PUBLIC_ALGORAND_NETWORK \
    NEXT_PUBLIC_COINFLIP_APP_ID=$NEXT_PUBLIC_COINFLIP_APP_ID \
    NEXT_PUBLIC_MIN_BET_MICROALGO=$NEXT_PUBLIC_MIN_BET_MICROALGO \
    NEXT_PUBLIC_MAX_BET_MICROALGO=$NEXT_PUBLIC_MAX_BET_MICROALGO
COPY packages/types packages/types
COPY packages/sdk packages/sdk
COPY packages/price-client packages/price-client
COPY packages/nfd packages/nfd
COPY apps/game apps/game
COPY tsconfig.base.json ./
RUN pnpm --filter @fairground/game... build

# --- runtime: next start ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/game
EXPOSE 3000
CMD ["pnpm", "start"]
