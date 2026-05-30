# @fairground/api

REST + WebSocket API for the Fairground on-chain games platform.

Built with Hono 4 on Node.js. Single process; no background workers — the keeper handles all chain interaction.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/games/:gameId/bets` | Build the unsigned flip() txn group; persist a pending bet+session record. Returns the group for the client to sign. |
| `GET` | `/games/:gameId/state/:sessionId` | Poll session state (pending / resolving / resolved / refunded). BigInt fields as strings. |
| `GET` | `/leaderboard?limit=50&offset=0&sortBy=pnl` | Top wallets by net P&L (from Redis ZSET) or by volume/wins (from DB snapshot). |
| `GET` | `/proof/:txnId` | Proof card PNG for a resolved bet. Generated on first request (~500ms), served from Redis cache permanently thereafter. |
| `GET` | `/ws` | WebSocket. Keeper publishes to Redis `fg:events`; API fans out to connected clients. Events: `resolved`, `jackpot`, `treasury_paused`, `ping`. |
| `GET` | `/health` | Liveness probe. |
| `GET` | `/metrics` | Prometheus metrics (prom-client). Firewall from public in production. |

## Environment

All variables defined in `.env.example` at the repo root. Validated at startup via `ApiEnvSchema` from `@fairground/types`.

Key variables for the API:

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3010` | HTTP + WS port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | ioredis connection string |
| `ALGOD_URL` | — | Algorand node URL |
| `CORS_ORIGINS` | `https://fairground.xyz,...` | Comma-separated allowed origins |
| `COINFLIP_APP_ID` | — | Deployed contract bigint app ID |
| `HOUSE_TREASURY_APP_ID` | — | Deployed treasury bigint app ID |
| `VRF_BEACON_APP_ID` | `947957720` | Mainnet Applied Blockchain beacon |

## Geo-blocking

`src/middleware/geoBlock.ts` reads `CF-IPCountry` (Cloudflare) and blocks US, GB, TH, ID, IN, BR.

**This is a soft layer.** Real enforcement requires Cloudflare Workers geo-blocking at the CDN edge. Both layers must be active before any public announcement or Foundation RT. See `docs/compliance.md`.

## Relation to keeper

- `packages/keeper` is the only writer to the `sessions` table (state transitions pending → resolving → resolved).
- The API creates the initial pending session on `POST /games/:gameId/bets`.
- The keeper publishes to the Redis `fg:events` channel; the API WebSocket fans out to clients.
- The API never signs transactions — it only builds unsigned groups for the client wallet.

## Development

```bash
# From repo root
pnpm dev --filter @fairground/api

# Standalone
cd packages/api
tsx watch src/index.ts
```

Requires a running Postgres and Redis. Use the Docker Compose at the repo root.
