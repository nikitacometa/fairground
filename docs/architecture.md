# Architecture

## Stack

| Layer | Tech | Version | Rationale |
|-------|------|---------|-----------|
| Monorepo | pnpm workspaces + Turborepo | pnpm 11.5.0, turbo 2.9.16 | pnpm strict isolation prevents accidental cross-package dep leakage; turbo caches build/test/lint tasks, saving 40-60s per iteration |
| Contracts | algorand-python + puyapy | 3.5.0 / 5.8.1 | Algorand Foundation standard toolchain. puyapy 5.8.1 outputs ARC-56 JSON; `algokit generate client` produces typed TS clients. Never write "Puya v5.0" in technical contexts — pip packages are `algorand-python` and `puyapy` with separate version numbers. AlgoKit 3.x does not exist. |
| SDK | algosdk + algokit-utils + generated clients | 3.5.2 / 9.2.0 / 6.0.1 | Generated clients from `algokit-client-generator@6.0.1` are the only interface between TS code and contracts. No raw algosdk group construction in apps. |
| Wallet | @txnlab/use-wallet-react | 4.6.0 | Handles Pera (native SDK), Defly, Lute, Kibisis, Exodus behind a single `useWallet()` hook. Replaces 500+ lines of hand-rolled WC v2 session management. |
| API | Hono + @hono/node-server | 4.12.23 / 2.0.4 | 3 HTTP routes per game + 1 WS namespace. Web Standard API enables future Cloudflare Worker deployment for the proof-card CDN endpoint. |
| Web | Next.js App Router (game) + Astro (landing) | 16.2.6 / 6.4.2 | Game dApp needs RSC for leaderboard/history pages + client components for game canvas + WS. Astro for static landing (zero JS for non-interactive sections). |
| DB | Drizzle ORM + PostgreSQL | 0.45.2 / pg 8.21.0 | Three tables per game + shared treasury/jackpot. Drizzle generates pure SQL, no binary generation. Keeper batch UPDATE is expressible verbatim. |
| Realtime | Hono WS + ioredis pub/sub | ws 8.21.0 / ioredis 5.11.0 | Keeper publishes to Redis pub/sub; Hono WS subscribes and fans out. Keeper crashes don't drop WS connections. |
| Keeper | tsx polling + Redis SETNX | tsx 4.22.3 | VRF resolution is not a retryable job — each event is a unique on-chain outcome. Two containers, SETNX leader election (10s TTL, refreshed every 4s). |
| Proof card | satori + @resvg/resvg-js + sharp | 0.26.0 / 2.6.2 / 0.34.5 | Generates shareable VRF result PNGs. Redis caches `proof:{txnId}` permanently (proofs are immutable). |
| Styling | Tailwind CSS 4 | 4.3.0 | OKLCH design tokens. Amber-gold primary `oklch(0.78 0.18 65)`. |
| Testing | Vitest | 4.1.7 | Native ESM. Contract integration tests hit AlgoKit LocalNet (Docker). |
| VRF | Algorand VRF Beacon | app ID 947957720 (mainnet) | Free. Commit-reveal: bet commits to round N+8 (~22s). `resolve()` reads beacon output synchronously. 48h player-triggered refund backdoor required in all game contracts. |
| Deploy | Docker Compose on Hostinger VPS | Separate from Cometa stack | `~/fairground/docker-compose.yml`. Landing deploys as static files via rsync. |

## Monorepo

```
fairground/
├── apps/
│   ├── game/              # Next.js 16 App Router
│   └── landing/           # Astro 6 static site
├── packages/
│   ├── contracts/         # Python-only AlgoKit workspace (NOT a pnpm package)
│   │   ├── .algokit.toml
│   │   ├── pyproject.toml
│   │   ├── smart_contracts/
│   │   │   ├── house_treasury/
│   │   │   ├── coinflip/
│   │   │   └── leaderboard/
│   │   ├── artifacts/     # *.arc56.json (puyapy output, never edit by hand)
│   │   └── tests/
│   ├── sdk/               # @fairground/sdk
│   │   └── src/
│   │       ├── clients/   # Generated TS clients (never edit by hand)
│   │       ├── vrf/
│   │       │   └── beacon.ts
│   │       └── index.ts
│   ├── types/             # @fairground/types
│   ├── db/                # @fairground/db
│   ├── api/               # @fairground/api
│   ├── keeper/            # @fairground/keeper
│   ├── proof-card/        # @fairground/proof-card
│   └── price-client/      # @fairground/price-client
├── docs/
├── ops/
├── .claude/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

### Contract build order

1. `house_treasury` — must be deployed first. All game contracts read `get_available_balance()` via foreign app reference.
2. `coinflip` — reads `HOUSE_TREASURY_APP_ID` at construction time.
3. `leaderboard` — receives inner app calls from game contracts on every resolution.

Compile: `algokit compile py smart_contracts/`  
Generate clients: `algokit generate client artifacts/coinflip.arc56.json --output ../sdk/src/clients/CoinflipClient.ts`

Open question: verify that `algokit-client-generator@6.0.1` accepts ARC-56 input from `puyapy 5.8.1`. Compile one contract, run the generator, check the output shape before committing to the pipeline. Fallback: use `--output-arc32` flag in puyapy if the generator rejects ARC-56.

## Data Flow

### Bet submission

```
User (browser)
  → useWallet().signTransactions()           # @txnlab/use-wallet-react
  → CoinflipClient.flip(salt_hash, referrer) # @fairground/sdk generated client
  → Algorand mainnet                         # atomic group: payment + app call
      → CoinflipContract.flip()              # Puya contract
          → Box storage write: player session (round, bet, salt, claimed=false)
          → Emit arc56 event: BetCommitted(wallet, round, amount)
  → API: POST /games/coinflip/bets           # Hono
      → Postgres insert: bets row (pending)
      → Redis publish: bet:{sessionId}       # notify keeper
```

### VRF resolution

```
Keeper (tsx poll, 4s loop)
  → Postgres query: sessions WHERE vrf_round <= current_round AND resolved_at IS NULL
  → Algod: confirm round exists
  → CoinflipClient.resolve(player)           # @fairground/sdk
      → CoinflipContract.resolve()           # Puya contract
          → Inner app call: VRF beacon (app 947957720)
              → Reads beacon output for committed round
          → Compute result: sha256(beacon_output || player_salt) mod 2
          → Win: inner ALGO transfer to player (1.96x)
          → Write: LeaderboardContract.record_result() via inner app call
          → Box storage: claimed=true
          → Emit arc56 event: BetResolved(wallet, outcome, amount)
  → Postgres update: resolved_at, outcome, vrf_output, txn_id
  → Redis publish: resolve:{sessionId}       # fans out to WS clients
  → proof-card: generate PNG, cache in Redis proof:{txnId}
```

### Proof card delivery

```
User (browser)
  → GET /proof/:txnId                        # Hono API
      → Redis: GET proof:{txnId}             # cache hit → return PNG
      → Cache miss:
          → Postgres: fetch bet row (vrf_output, outcome, wallet, amount)
          → @fairground/proof-card: render PNG (satori → SVG → @resvg → PNG → sharp)
          → Redis: SET proof:{txnId} PNG (no TTL — permanent)
          → Return PNG
  → Share intent: twitter.com/intent/tweet?url={proof_card_url}
```

### WebSocket events

```
Keepper
  → Redis PUBLISH fairground:events {type, payload}

API (Hono WS handler)
  → Redis SUBSCRIBE fairground:events
  → Fan out to all connected WS clients

Game frontend (apps/game)
  → Receives: BetResolved, JackpotTriggered, TreasuryPaused
  → Updates UI: result animation, jackpot counter, pause banner
```

## Shared House Treasury

A single `HouseTreasury` Puya contract accumulates rake from all games. Architecture:

- **Global pool**: single ALGO balance. Every game reads available balance before accepting a bet and writes rake after resolution.
- **Game registry**: map of approved game contract app IDs. Only registered games can call `deposit_rake()` and `request_payout()`.
- **`max_payout_bps`**: default 100 = 1% of live balance. Enforced at resolve time, not at bet time. If the live balance drops between bet and resolve, the max payout shrinks accordingly.
- **`emergency_pause`**: any registered game can trigger a platform-wide pause. Keeper monitors balance and triggers automatically below `TREASURY_MIN_BALANCE_MICROALGO`.
- **Seeding**: fund with 2,000 ALGO before CoinFlip launch. Fund with 5,000-10,000 ALGO before Minefield launch.

This contract must be deployed before any game contract. It is architecturally impossible to retrofit cross-game treasury after two contracts with separate pools are live.

## Keeper Architecture

Two Docker Compose containers with `restart: always`. Leader election via Redis SETNX:

- Lock key: `keeperlock`
- Lock TTL: 10 seconds
- Lock refresh: every 4 seconds (primary)
- Lock value: `KEEPER_INSTANCE_ID` (`primary` or `standby`)

If primary crashes, its lock expires after 10s, standby acquires lock and promotes within one poll cycle (≤4s after lock expiry). No double-resolve possible: `resolve()` contract call is idempotent — the idempotency key is `(beaconRound, walletAddress, sessionNonce)`. A second `resolve()` on an already-claimed box fails at the contract level.

VRF resolution is not a queue job (BullMQ semantics are wrong). Each resolution is a unique on-chain event. The keeper's responsibility is to notice the event exists and call the permissionless `resolve()` method. If the keeper fails for 48h, the player triggers `refund()` themselves — funds are never locked.

## Deploy Procedure

### First deploy

```bash
# 1. Build and push Docker images
docker compose build

# 2. Deploy HouseTreasury contract
cd packages/contracts
algokit deploy house_treasury --network mainnet
# Note the app ID

# 3. Fund treasury
# Send 2,000+ ALGO to the HouseTreasury contract account before proceeding

# 4. Deploy CoinflipContract with treasury app ID
algokit deploy coinflip --network mainnet --param house_treasury_app_id=<ID>

# 5. Deploy LeaderboardContract
algokit deploy leaderboard --network mainnet

# 6. Set env vars in docker-compose.yml
# HOUSE_TREASURY_APP_ID, COINFLIP_APP_ID, LEADERBOARD_APP_ID

# 7. Start services
docker compose up -d

# 8. Verify keeper resolving
docker compose logs -f fairground-keeper-primary
```

### Deploy verification

```bash
# API health
curl https://api.fairground.xyz/health

# Treasury balance
curl https://api.fairground.xyz/treasury/balance

# Geo-block working (use a US VPN)
curl -I https://app.fairground.xyz/  # expect 403
```

### Rollback

```bash
ssh hostinger "cd ~/fairground && git log --oneline -5"
ssh hostinger "cd ~/fairground && git checkout <prev-commit> && docker compose up -d --build api"
```

## Environment Variables

All required env vars validated with Zod at startup. Missing required vars crash the process immediately with a descriptive error.

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `NODE_ENV` | yes | — | `development\|production\|test` |
| `PORT` | no | `3010` | API HTTP port |
| `DATABASE_URL` | yes | — | `postgresql://user:pass@fairground-db:5432/fairground` |
| `REDIS_URL` | yes | — | `redis://fairground-redis:6379` |
| `ALGOD_URL` | yes | — | `https://mainnet-api.algonode.cloud` |
| `ALGOD_TOKEN` | no | `""` | Empty for public AlgoNode |
| `INDEXER_URL` | yes | — | `https://mainnet-idx.algonode.cloud` |
| `ALGORAND_NETWORK` | no | `localnet` | Claude Code default — forces explicit override for mainnet |
| `HOUSE_TREASURY_APP_ID` | yes | — | bigint via Zod coerce |
| `COINFLIP_APP_ID` | yes | — | bigint via Zod coerce |
| `VRF_BEACON_APP_ID` | no | `947957720` | bigint; override for testnet |
| `HOUSE_SEED_WALLET_MNEMONIC` | yes (keeper) | — | Never commit. 25-word mnemonic. |
| `MIN_BET_MICROALGO` | no | `500000` | 0.5 ALGO |
| `MAX_BET_MICROALGO` | no | `500000` | 0.5 ALGO |
| `TREASURY_MIN_BALANCE_MICROALGO` | no | `2000000000` | 2000 ALGO |
| `CORS_ORIGINS` | no | localhost + prod | Comma-separated |
| `KEEPER_INSTANCE_ID` | yes (keeper) | — | `primary\|standby` |
| `PLAUSIBLE_DOMAIN` | no | — | `fairground.xyz` |
| `WALLETCONNECT_PROJECT_ID` | yes (game) | — | Register at cloud.walletconnect.com |
