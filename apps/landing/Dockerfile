# Fairground landing (Astro static) -- multi-stage build, served by nginx.
# Build context is the repo root (see docker-compose.yml: context: .).
# PUBLIC_API_URL is inlined at build time (Astro exposes PUBLIC_* to the client).
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /app

# --- deps: install the landing + its workspace deps ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/types/package.json packages/types/
COPY packages/sdk/package.json packages/sdk/
COPY packages/proof-card/package.json packages/proof-card/
COPY apps/landing/package.json apps/landing/
RUN pnpm install --frozen-lockfile --filter @fairground/landing...

# --- build: astro static build ---
FROM deps AS build
ARG PUBLIC_API_URL
ENV PUBLIC_API_URL=$PUBLIC_API_URL
COPY packages/types packages/types
COPY packages/sdk packages/sdk
COPY packages/proof-card packages/proof-card
COPY apps/landing apps/landing
COPY tsconfig.base.json ./
RUN pnpm --filter @fairground/landing build

# --- runtime: static files via nginx ---
FROM nginx:alpine AS runtime
COPY --from=build /app/apps/landing/dist /usr/share/nginx/html
EXPOSE 80
