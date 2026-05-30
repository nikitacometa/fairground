# Fairground

Provably fair on-chain degen games platform on Algorand, powered by Algorand's native VRF randomness beacon.

Every outcome is committed to an Algorand block before any card is turned. Every result is a verifiable, shareable artifact. The house edge is on-chain and fixed. There is no oracle fee, no centralized RNG, no trust required.

## Platform Thesis

Five games. One treasury. One leaderboard. One proof card engine.

Coinflip ships first — not because it is the best game, but because it proves the VRF proof card loop, seeds the house pool, and validates wallet integration in 10-14 days. Algo Minefield (v2) is the retention engine: variable-ratio reinforcement, perceived agency, and a full-board-clear jackpot event that earns a thread, not just a tweet. Each game after that inherits working infrastructure and adds a player entry point into a single cross-game identity system.

The shared house treasury means a viral spike on one game does not drain funds another game depends on. The cross-game leaderboard means a player who discovers Fairground through a coinflip proof card arrives at Minefield to find their wallet already has a rank.

## Monorepo Map

```
fairground/
├── apps/
│   ├── game/           # Next.js 16 App Router — game dApp (app.fairground.xyz)
│   └── landing/        # Astro 6 static landing (fairground.xyz)
├── packages/
│   ├── contracts/      # Puya contracts — NOT a pnpm package (AlgoKit workspace)
│   │   └── smart_contracts/
│   │       ├── house_treasury/   # Build this first
│   │       ├── coinflip/
│   │       └── leaderboard/
│   ├── sdk/            # @fairground/sdk — generated ARC-56 TS clients + VRF helpers
│   ├── types/          # @fairground/types — Zod schemas, shared TypeScript types
│   ├── db/             # @fairground/db — Drizzle ORM schema + pg client
│   ├── api/            # @fairground/api — Hono REST + WebSocket server
│   ├── keeper/         # @fairground/keeper — VRF session resolver (tsx polling)
│   ├── proof-card/     # @fairground/proof-card — satori PNG generator
│   └── price-client/   # @fairground/price-client — Vestige price batching
├── docs/
│   ├── architecture.md
│   ├── tokenomics.md
│   ├── compliance.md
│   ├── roadmap.md
│   └── game-specs/
│       ├── coinflip.md
│       └── minefield.md
├── docs/research/      # algorand-degen-games-2026-05.md (design bible)
├── ops/                # geo-blocking.md, weekly-plan.md, safety-state.md
├── .claude/            # Claude Code config, skills, hooks
├── docker-compose.yml  # Separate stack from Cometa
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .eslintrc.js
├── .prettierrc
├── BOARD.md
└── AGENTS.md
```

## Quickstart

### Prerequisites

- pnpm 11.5.0: `npm install -g pnpm@11.5.0`
- Node.js 22+
- AlgoKit 2.10.2: `pipx install algokit==2.10.2`
- Docker (for LocalNet and PostgreSQL)

### Install

```bash
pnpm install
```

### Build all packages

```bash
pnpm build
```

Turbo caches build artifacts by dependency graph. First build: ~60s. Subsequent builds with no changes: <2s.

### Development

Start the full stack (API, game dApp, LocalNet via Docker):

```bash
# Terminal 1 — LocalNet
algokit localnet start

# Terminal 2 — Postgres + Redis
docker compose up fairground-db fairground-redis

# Terminal 3 — API + keeper
pnpm dev

# Terminal 4 — game dApp
pnpm --filter apps/game dev
```

Game dApp: http://localhost:3000  
API: http://localhost:3010  
API docs: http://localhost:3010/doc

### Contracts

Contracts are in `packages/contracts/` — a Python-only AlgoKit workspace, not a pnpm package.

```bash
cd packages/contracts

# Activate venv
algokit project bootstrap
source .venv/bin/activate

# Compile all contracts (outputs ARC-56 JSON to artifacts/)
algokit compile py smart_contracts/

# Generate typed TS clients (outputs to packages/sdk/src/clients/)
algokit generate client artifacts/house_treasury.arc56.json --output ../sdk/src/clients/HouseTreasuryClient.ts
algokit generate client artifacts/coinflip.arc56.json --output ../sdk/src/clients/CoinflipClient.ts

# Run contract tests (requires LocalNet)
algokit localnet start
python -m pytest tests/ -v
```

Build order is enforced: `house_treasury` must be compiled and deployed before any game contract. The coinflip contract reads `HouseTreasury.get_available_balance()` via a foreign app reference on every `resolve()` call.

### Run linting and tests

```bash
# Lint all packages
pnpm lint

# Format
pnpm format

# Test all packages (Vitest)
pnpm test

# Test with UI
pnpm test --ui
```

### Deploy to mainnet

See `docs/architecture.md` for the full deploy procedure. Short version:

```bash
# 1. Deploy HouseTreasury first
# 2. Fund it with minimum 2000 ALGO before coinflip launch
# 3. Deploy CoinflipContract with house_treasury_app_id set
# 4. Set HOUSE_TREASURY_APP_ID and COINFLIP_APP_ID in docker-compose.yml env
# 5. docker compose up -d
```

Never deploy game contracts before the treasury is funded. Never make a public announcement before geo-blocking is in place.

## Stack at a Glance

| Layer | Tech | Version |
|-------|------|---------|
| Contracts | Puya (algorand-python + puyapy) | algorand-python 3.5.0, puyapy 5.8.1 |
| TS SDK | algosdk + algokit-utils + generated clients | algosdk 3.5.2 |
| Wallet | @txnlab/use-wallet-react | 4.6.0 |
| API | Hono + @hono/node-server | 4.12.23 |
| Game dApp | Next.js App Router | 16.2.6 |
| Landing | Astro | 6.4.2 |
| Database | Drizzle ORM + PostgreSQL | drizzle-orm 0.45.2 |
| Realtime | Hono WS + ioredis pub/sub | ws 8.21.0 |
| Keeper | tsx polling + Redis SETNX | tsx 4.22.3 |
| Proof card | satori + @resvg/resvg-js + sharp | satori 0.26.0 |
| Styling | Tailwind CSS 4 | 4.3.0 |
| Tests | Vitest | 4.1.7 |
| Monorepo | pnpm workspaces + Turborepo | pnpm 11.5.0, turbo 2.9.16 |

## Links

- [Architecture](docs/architecture.md)
- [Tokenomics](docs/tokenomics.md)
- [Compliance](docs/compliance.md)
- [Roadmap](docs/roadmap.md)
- [Coinflip spec](docs/game-specs/coinflip.md)
- [Minefield spec](docs/game-specs/minefield.md)
- [Task board](BOARD.md)
- [Design bible](docs/research/algorand-degen-games-2026-05.md)
