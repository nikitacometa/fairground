# Fairground — Claude Code Project Instructions

## Project Identity

**Fairground** is a provably-fair on-chain degen games platform built on Algorand, powered by Algorand's native VRF beacon (app ID 947957720 on mainnet). The brand is intentionally separate from Cometa — regulatory distance from Cometa's FaaS business and the Algorand Foundation relationship is a deliberate architecture decision, not cosmetic. Rename is trivial if needed; the separation is not.

**Positioning:** "Provably fair games on Algorand." Survivors in crypto gambling win on honest, verifiable fairness (SatoshiDice 2012, Bustabit 2014, Rollbit 2020). The VRF proof card — a shareable PNG showing VRF round, beacon output hash, and transaction ID — is the marketing budget.

**Repository:** `~/dev/cometa/fairground/` — `git@github.com:nikitacometa/fairground.git` (personal account)
**npm scope:** `@fairground/*`
**Task IDs:** `FG-NNN`
**Status (May 2026):** Pre-launch, building CometaFlip v1 (Days 1-14 on the roadmap)

**On the directory location:** Fairground lives under `~/dev/cometa/` next to `prediction-market` (same Puya/AlgoKit stack) and `cometa-strategy` (which holds the design bible). This is a _local dev convenience_ — it inherits the parent `~/dev/cometa/CLAUDE.md` Algorand context via the Claude ancestor chain. It does NOT make Fairground part of the Cometa product. Brand separation is enforced where it matters: separate GitHub repo, separate domain, separate on-chain entity, separate public brand. The folder path is not a compliance surface.

**Design bible (read this before any product decision):**
`docs/research/algorand-degen-games-2026-05.md` — full survival analysis, 11 game concepts, validation matrix, tokenomics playbook, launch roadmap, platform thesis, compliance notes.
`docs/research/algorand-build-ideas-2026-05.md` — ecosystem context.
Every architectural decision is traceable to these docs. When in doubt, re-read them.

---

## Stack

| Layer         | Technology                                            | Pinned Version                                                                                                                                                           | Notes                                                                                                                                           |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| monorepo      | pnpm workspaces + Turborepo                           | pnpm 11.5.0, turbo 2.9.16                                                                                                                                                | `pnpm-workspace.yaml` covers `packages/*` and `apps/*`                                                                                          |
| contracts     | algorand-python (Puya) + AlgoKit                      | algorand-python==3.5.0, puyapy==5.8.1, algorand-python-testing==1.1.0, algokit 2.10.2                                                                                    | Never write "Puya v5.0" in technical docs. AlgoKit 3.x does not exist. puyapy 5.8.1 outputs ARC-56 JSON by default                              |
| sdk           | algosdk + algokit-utils + generated ARC-56 TS clients | algosdk@3.5.2, @algorandfoundation/algokit-utils@9.2.0, @algorandfoundation/algokit-client-generator@6.0.1                                                               | Generated clients from algokit-client-generator are the ONLY interface between TS code and contracts. No raw algosdk group construction in apps |
| wallet        | @txnlab/use-wallet-react                              | @txnlab/use-wallet@4.6.0, @txnlab/use-wallet-react@4.6.0, @perawallet/connect@1.5.2, @blockshake/defly-connect@1.2.1                                                     | Requires algosdk ^3.x — compatible with 3.5.2                                                                                                   |
| api           | Hono + @hono/node-server                              | hono@4.12.23, @hono/node-server@2.0.4, @hono/zod-validator@0.8.0                                                                                                         | Web Standard API enables future Cloudflare Worker deployment for proof-card CDN                                                                 |
| web (game)    | Next.js App Router                                    | next@16.2.6, react@19.2.6                                                                                                                                                | RSC for leaderboard/history pages; client components for game canvas + WS                                                                       |
| web (landing) | Astro                                                 | astro@6.4.2, @astrojs/react@5.0.6                                                                                                                                        | Static, deploys via rsync in ~3s                                                                                                                |
| db            | Drizzle ORM + PostgreSQL                              | drizzle-orm@0.45.2, drizzle-kit@0.31.10, pg@8.21.0                                                                                                                       | Drizzle generates pure SQL, no binary generation step                                                                                           |
| realtime      | Hono WS + ioredis pub/sub                             | ws@8.21.0, ioredis@5.11.0                                                                                                                                                | Keeper publishes to Redis pub/sub; Hono WS fans out to clients                                                                                  |
| keeper        | tsx polling process + Redis SETNX                     | tsx@4.22.3                                                                                                                                                               | Two instances (primary + standby), 10s TTL lock refreshed every 4s                                                                              |
| proof-card    | satori + @resvg/resvg-js + sharp                      | satori@0.26.0, @resvg/resvg-js@2.6.2, sharp@0.34.5                                                                                                                       | PNG generation, Redis caches `proof:{txnId}` permanently                                                                                        |
| styling       | Tailwind CSS                                          | tailwindcss@4.3.0, @tailwindcss/vite                                                                                                                                     | OKLCH design tokens. Amber-gold primary: `oklch(0.78 0.18 65)`                                                                                  |
| testing       | Vitest                                                | vitest@4.1.7                                                                                                                                                             | `vitest.workspace.ts` at root covers all packages                                                                                               |
| lint          | ESLint + Prettier + Husky + lint-staged               | eslint@9.39.0 (flat config), typescript-eslint@8.60.0, @eslint/js@9.39.0, globals@17.6.0, eslint-config-prettier@10.1.8, prettier@3.8.3, husky@9.1.7, lint-staged@17.0.6 | `no-floating-promises=error`, `no-explicit-any=error`. Config: `eslint.config.mjs` (flat config). No `.eslintrc.*` files.                       |
| vrf           | Algorand VRF Beacon (Applied Blockchain)              | app ID 947957720 (mainnet)                                                                                                                                               | Free. Commit-reveal: bet commits to round N+8 (~22s wait)                                                                                       |
| build         | TypeScript + tsup                                     | typescript@6.0.3, tsup@8.5.1                                                                                                                                             | TS project references across packages                                                                                                           |
| deploy        | Docker Compose on Hostinger VPS                       | Separate stack from Cometa (`~/fairground/docker-compose.yml`)                                                                                                           | Nginx reverse proxy                                                                                                                             |

---

## Monorepo Layout

```
fairground/
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.mjs
├── .prettierrc
├── .gitignore
├── CLAUDE.md
├── AGENTS.md
├── BOARD.md
├── SKILLS.md
│
├── packages/
│   ├── contracts/          # Python-only AlgoKit workspace (NOT a pnpm package)
│   │   ├── .algokit.toml
│   │   ├── pyproject.toml
│   │   ├── smart_contracts/
│   │   │   ├── house_treasury/   # FIRST contract to build — all games depend on it
│   │   │   ├── coinflip/         # CometaFlip v1, ~150-200 lines
│   │   │   └── leaderboard/      # Cross-game leaderboard stub
│   │   ├── artifacts/            # *.arc56.json — auto-generated, never edit by hand
│   │   └── tests/                # algorand-python-testing suite
│   │
│   ├── sdk/                # @fairground/sdk — bridge between Puya contracts and TS
│   │   └── src/
│   │       ├── clients/    # Generated by algokit-client-generator — never edit
│   │       └── vrf/
│   │           └── beacon.ts  # MAINNET_BEACON_APP_ID=947957720n
│   │
│   ├── types/              # @fairground/types — shared Zod 4.4.3 schemas
│   ├── db/                 # @fairground/db — Drizzle schema + pg client
│   ├── api/                # @fairground/api — Hono REST + WebSocket
│   ├── keeper/             # @fairground/keeper — VRF session resolver
│   ├── proof-card/         # @fairground/proof-card — satori PNG generator
│   └── price-client/       # @fairground/price-client — Vestige price batching
│
├── apps/
│   ├── game/               # Next.js 16 App Router game dApp
│   └── landing/            # Astro 6 + Tailwind 4 + React 19 islands
│
├── docs/
│   └── research/
│       ├── algorand-degen-games-2026-05.md   # Design bible — source of truth
│       └── algorand-build-ideas-2026-05.md   # Ecosystem context
│
├── ops/
│   ├── geo-blocking.md     # Cloudflare Workers geo-block spec — required before launch
│   ├── weekly-plan.md
│   └── safety-state.md
│
├── docker-compose.yml      # Separate stack from ~/cometa/docker-compose.yml
├── .mcp.json
└── .claude/
    └── settings.json
```

---

## Build / Test / Lint / Deploy Commands

### Monorepo (run from repo root)

```bash
# Install dependencies
pnpm install

# Build all packages (turbo, respects dependency graph)
pnpm turbo build

# Run all tests
pnpm turbo test

# Lint all packages
pnpm turbo lint

# Type-check all packages
pnpm turbo typecheck

# Run specific package
pnpm --filter @fairground/api dev
pnpm --filter apps/game dev
```

### Contracts (packages/contracts — AlgoKit, not pnpm)

```bash
cd packages/contracts

# Compile all contracts (outputs ARC-56 artifacts/)
algokit compile python smart_contracts/

# Generate typed TS clients from ARC-56 artifacts
algokit generate client packages/contracts/artifacts/ --output packages/sdk/src/clients/

# Run contract tests (LocalNet must be running)
algokit localnet start
python -m pytest tests/ -v

# Bootstrap LocalNet
algokit localnet reset
```

### API

```bash
pnpm --filter @fairground/api dev      # hot reload via tsx watch
pnpm --filter @fairground/api build    # tsup bundle
pnpm --filter @fairground/api start    # production
```

### Game dApp

```bash
pnpm --filter apps/game dev     # Next.js dev server, port 3000
pnpm --filter apps/game build
pnpm --filter apps/game start
```

### Landing

```bash
pnpm --filter apps/landing dev     # Astro dev server, port 4321
pnpm --filter apps/landing build
pnpm --filter apps/landing deploy  # rsync to VPS
```

### Docker (production)

```bash
# Deploy all services
docker compose -f ~/fairground/docker-compose.yml up -d --build

# Tail logs
docker compose -f ~/fairground/docker-compose.yml logs -f fairground-api
docker compose -f ~/fairground/docker-compose.yml logs -f fairground-keeper-primary

# Services: fairground-api (port 3010), fairground-keeper-primary,
# fairground-keeper-standby, fairground-db (postgres:16-alpine, not exposed),
# fairground-redis (redis:7-alpine, not exposed)
```

### DB Migrations

```bash
pnpm --filter @fairground/db db:generate   # drizzle-kit generate
pnpm --filter @fairground/db db:push       # push to local dev DB
# Production: keeper runs migrations on startup
```

### Health checks

```bash
curl https://api.fairground.xyz/leaderboard
curl https://fairground.xyz/  # landing
```

---

## Conventions

### TypeScript

- TypeScript 6.0.3. Every package extends `tsconfig.base.json` at repo root.
- Options: `strict`, `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames`, `target ES2021`, `resolveJsonModule`, `esModuleInterop`.
- **Do not add** `emitDecoratorMetadata` or `experimentalDecorators` — those are NestJS-specific.
- TS project references across packages for type safety without bundling during development.
- `paths` in each package's `tsconfig.json` for `@fairground/*` workspace imports.

**bigint rule — no exceptions:** All microALGO amounts, ASA amounts, Algorand app IDs, and round numbers are `bigint` in TypeScript. Never `Number`. API responses serialize `bigint` as `string` via a JSON replacer. Zod schemas use `z.coerce.bigint()` for env vars and API inputs.

- Prefer `unknown` over `any`. If you think you need `any`, you probably need a generic or a type guard.
- Declare return types on all exported/public functions.
- Use `jest.mocked()` or `DeepMocked<T>` for mock type casting — never `as never` / `as unknown as`.

### ESLint

Config: `eslint.config.mjs` at repo root (flat config, ESLint 9). Plugins: `typescript-eslint@8.60.0` unified package with `recommendedTypeChecked`. Critical rules:

- `no-floating-promises: error` — catches unhandled async in keeper bot code
- `require-await: error`
- `no-explicit-any: error`
- `no-unused-vars: error` with `argsIgnorePattern: '^_'`

### Prettier

`singleQuote: true, trailingComma: 'all', tabWidth: 2, semi: true, printWidth: 100, bracketSpacing: true, arrowParens: 'always', endOfLine: 'lf'`

Husky 9.1.7 + lint-staged 17.0.6 runs `eslint --fix && prettier --write` on staged `*.ts`/`*.tsx` files before every commit. Never use `--no-verify`.

### Testing

- Vitest 4.1.7 everywhere. `vitest.workspace.ts` at root covers all packages.
- `IVrfBeacon` interface with a `LocalNetStub` for deterministic contract tests.
- **Kill-the-mutant check** required: comment out a key line in the SUT and confirm at least one test fails before committing.
- For every `mockResolvedValue`, add a `mockRejectedValue` sibling test.
- Use `it.each()` for parameterized bet amounts — never duplicate test structure in separate `it()` blocks.
- For `$transaction` mocks, include a test where the callback throws (verifies rollback behavior).
- Contract integration tests hit AlgoKit LocalNet (Docker). Unit tests mock the algosdk client.
- **Never commit if test count decreases.** Baseline test count is tracked here; update when adding test suites.

### Commit Discipline

- Lowercase verb, no type prefix: `add coinflip contract v1`, `fix max-bet enforcement in house treasury`, `implement proof card PNG generator`.
- No `feat:` / `fix:` / `chore:` prefixes. No internal jargon (no "Phase 1", "FG-007" in commit messages). No co-authorship lines. Never `--no-verify`.
- Update `BOARD.md` task status in the same commit as the code it closes.
- Push after committing.
- Verify contracts are tested before committing contract changes: `python -m pytest tests/ -v` must pass.

### Error Handling

- Never catch and swallow errors. Always rethrow, log with context via `pino`, or return a typed error.
- Every `try/catch` in production code needs a corresponding test for the catch branch.
- Empty catch blocks are forbidden.
- Use `simulate()` before `send()` on non-trivial on-chain operations.

### Code Generation (Critical)

- `packages/sdk/src/clients/` is auto-generated by `algokit-client-generator@6.0.1` from `packages/contracts/artifacts/*.arc56.json`.
- **Never edit generated files by hand.** Regenerate via `algokit generate client`.
- Verify every import exists in the actual package version before using it — do not invent API shapes.
- Verify package names exist before adding new dependencies.

---

## Algorand / VRF Specifics

### VRF Beacon

- **Mainnet beacon app ID:** `947957720` — defined as `MAINNET_BEACON_APP_ID = 947957720n` in `packages/sdk/src/vrf/beacon.ts`.
- Commit-reveal pattern: bet transaction commits to VRF beacon round N+8 (~22 seconds at 2.8s block time). The `resolve()` call reads beacon output synchronously via inner app call after that round passes.
- **Minimum commit round is N+8.** N+4 can arrive before the user's transaction confirms under congestion. Never reduce this parameter.
- **`BEACON_SETTLE_BUFFER = 4`.** The beacon writes proofs up to 3 rounds after the N+8 target. `resolve()` asserts `current_round >= commit_round + BEACON_SETTLE_BUFFER` before calling `must_get()`. Using a buffer of 2 risks calling `must_get()` before the proof exists → panic → unresolvable session.
- **48-hour player-triggered refund backdoor** is required in all game contracts. Keeper failure must never lock player funds.
- `resolve()` is permissionless — any wallet can call it once the VRF round has passed. Keeper calls it; players can call it themselves.
- Idempotency key: `beaconRound + walletAddress + sessionNonce` prevents double-payout on retry.

### TESTNET_BEACON_APP_ID

The research cites `110096026` but this must be verified via `algorand` MCP (`api_algod_get_application_by_id`) before any testnet integration tests are written. Never hardcode without verification.

### Box Storage

- Max box size: 2500 bytes.
- Max box references per app call: 8.
- Box MBR: `2500 + 400 * (key_length + value_length)` microALGO must be pre-funded before box access, or the transaction fails with `invalid box reference`.
- CometaFlip box per player: key = address (32 bytes), value = vrf_round (8) + bet_amount (8) + salt_hash (32) + referrer (32) = **80 bytes**. No `claimed` field — box deletion is the idempotency guard. `BOX_MBR = 49,300 microALGO` (prefix `flip:` = 5 bytes → `2500 + 400*(37+80) = 49,300`). Include this in bet transaction payment.
- Never delete the flip box until all inner transactions (payout, referral transfer) have been submitted.

### House Treasury Architecture

- `house_treasury` contract is the single shared bankroll. It must be deployed **before** any game contract. All game contracts read `get_available_balance()` via foreign app ref.
- **Capital flow (decided):** bets are escrowed in the coinflip contract during the pending phase. On `resolve()`, the stake is swept to `house_treasury` via inner transfer before paying winners out of the treasury. On `refund()`, the bet + MBR are paid directly from the coinflip contract's own balance — the treasury is never touched during a refund, so the 48-hour player backdoor works even when the treasury is paused or the keeper is down.
- `max_payout_bps` default: 100 (1% of live treasury balance). Enforced at `resolve()` time — not at bet time. The balance can change between bet and resolve.
- `emergency_pause` flag halts all game contracts that check it. **It does not affect `refund()`** — refunds pay from the game contract directly.
- **Minimum viable treasury before any public announcement:** 2,000 ALGO for CometaFlip v1. Before Foundation amplification: 5,000-10,000 ALGO. Sub-2000 ALGO is below the solvency floor for a game with 0.5 ALGO max bets.

### Inner Transaction Limits

- Max 256 inner transactions per group.
- Max 16 transactions per atomic group.

### ARC-56 Pipeline

`algokit-client-generator@6.0.1` fully accepts ARC-56 input from `puyapy 5.8.1`. The npm description ("ARC-0032") is stale. Clients have been generated successfully — see `packages/sdk/src/clients/`. No `--output-arc32` fallback needed. v7.0.0-beta is in progress; stay on 6.0.1 until it stabilizes.

---

## Degen Games Context

### Platform Thesis

The five games are five entry points into one identity system, not five separate products:

- **Shared house treasury** (`house_treasury` contract) — accumulates rake from all games. Seeded at CometaFlip launch.
- **Cross-game leaderboard** — single box storage contract tracking per-wallet: games played, net ALGO P&L, jackpot hits, last active round.
- **Proof card engine** — one PNG generator endpoint, all games share it with different templates.

### Game Roadmap

| Phase | Game                  | Status                | Contract Lines                         | House Pool Requirement            |
| ----- | --------------------- | --------------------- | -------------------------------------- | --------------------------------- |
| 1     | CometaFlip (coinflip) | Building              | ~150-200 Puya                          | 2,000 ALGO seed, 0.5 ALGO max bet |
| 2     | Algo Minefield        | Planned (Weeks 2-10)  | ~500-700 Puya                          | 5,000-10,000 ALGO before launch   |
| 3     | Algo Oracle Games     | Planned (Weeks 8-14)  | ~80% reuse from prediction-market repo | Keeper pattern from Minefield     |
| 4     | PackFight             | Planned (Weeks 14-20) | ~700 Puya                              | Established player base required  |
| 5     | Memecoin Death Race   | Planned (Weeks 18-26) | ~600-800 Puya                          | ASA partner confirmation required |

### What NOT to Build in v1

- No jackpot in CometaFlip v1 — add in v1.2 after measuring actual bets/day.
- No COMETA/MINE token until 500+ weekly active wallets.
- No crash/multiplier mode until CometaFlip confirms 50+ daily players.
- No ASA denomination in CometaFlip v1.0 — ALGO only; add in v1.1 as parameter change.
- No sSYN yield-bearing receipt token — security classification in every jurisdiction.
- No mobile-native app — Pera deep-links handle mobile.

### Economics

- House edge: 2% on all house-banked games (parimutuel games hold zero race risk — rake only).
- Referral: 0.5% of house rake to optional referrer wallet parameter in bet transaction (~20 lines of Puya).
- Max payout: 1% of live treasury balance enforced per `resolve()` app call.
- Auto-pause threshold: treasury drops below 2,000 ALGO.

### Tokenomics (Phase 2 only)

Fixed-supply token, zero emission, 20% of weekly house gross buys-and-burns from Tinyman. Token utility: proof card skin variants, leaderboard badge color, 1.5x jackpot draw weight. **No revenue share to token holders** — triggers SEC/CFTC security classification. Only after 500+ weekly active wallets and $50K+/month revenue.

---

## Compliance / Regulatory

**This is house-banked gambling.** Treating it as anything else operationally is a legal risk, not a framing choice.

### Geo-blocking (Required Before Any Public Announcement)

Blocked jurisdictions: **US, UK, TH (Thailand), ID (Indonesia), IN (India), BR (Brazil)**.

Geo-block spec lives in `ops/geo-blocking.md`. Cloudflare Workers geo-block is preferred over IP detection middleware in `packages/api` — CDN layer cannot be bypassed by changing Accept-Language headers.

**Thai block is non-negotiable.** Thailand bans online gambling including crypto formats, with active enforcement (220K+ URLs blocked in 3.5 months). Operating from Bangkok without blocking Thai IPs is direct legal exposure.

The geo-block must be live and verified before submitting CometaFlip to any ecosystem newsletter or requesting a Foundation RT.

### Foundation Amplification Strategy

Framing: "VRF tech demonstration that also pays out." The Algorand Foundation amplifies open-source VRF tooling and provably-fair mechanics. It does not amplify casino games. These two facts must coexist in all public messaging. Never describe the platform as gambling in any content targeting Foundation channels.

### xGov Path

A shipped open-source on-chain game with VRF proof infrastructure and 10K+ on-chain bets qualifies for retroactive xGov at Medium tier (50K-250K ALGO, ~$5,900-$29,500). Open-source the contracts from day one.

### Licensing

At 0.5 ALGO max bets, sub-$1 stakes, crypto-only, no fiat on-ramp: enforcement interest threshold is below the horizon for a solo operator. Invest in Curacao licensing at $50K+/month revenue when it becomes the actual constraint — not before.

### Parimutuel vs House-Banked Tradeoff

Parimutuel (Memecoin Death Race, Algo Oracle Games): house holds zero outcome risk, only rake. Regulatory profile is cleaner in most jurisdictions. House-banked (CometaFlip, Algo Minefield): house takes directional risk, but simpler mechanics and no liquidity dependency. CometaFlip ships first precisely because house-banked math is tractable at 2,000 ALGO seed + 0.5 ALGO max bet.

---

## Environment Variables

All env vars are validated with Zod at startup. `bigint` amounts use `z.coerce.bigint()`.

| Variable                         | Required         | Default              | Notes                                                                       |
| -------------------------------- | ---------------- | -------------------- | --------------------------------------------------------------------------- | ---------------------------------------- | ----- |
| `NODE_ENV`                       | Yes              | —                    | `development                                                                | production                               | test` |
| `PORT`                           | No               | 3010                 | API HTTP port                                                               |
| `DATABASE_URL`                   | Yes              | —                    | `postgresql://user:pass@fairground-db:5432/fairground`                      |
| `REDIS_URL`                      | Yes              | —                    | `redis://fairground-redis:6379`                                             |
| `ALGOD_URL`                      | Yes              | AlgoNode mainnet     | Use `https://localhost:4001` for LocalNet                                   |
| `ALGOD_TOKEN`                    | No               | `""`                 | Empty string for public AlgoNode endpoints                                  |
| `INDEXER_URL`                    | Yes              | AlgoNode mainnet idx | —                                                                           |
| `ALGORAND_NETWORK`               | No               | `localnet`           | `.claude/settings.json` default. Override explicitly for mainnet operations |
| `HOUSE_TREASURY_APP_ID`          | Yes (production) | —                    | `bigint`. Set after first deploy. Required before accepting bets            |
| `COINFLIP_APP_ID`                | Yes (production) | —                    | `bigint`. Required for coinflip routes                                      |
| `VRF_BEACON_APP_ID`              | No               | `947957720n`         | Defined in `@fairground/sdk` as constant. Override for testnet              |
| `HOUSE_SEED_WALLET_MNEMONIC`     | Yes (keeper)     | —                    | Never commit. `block-secret-commit.sh` hook guards staging                  |
| `MIN_BET_MICROALGO`              | No               | `500000n`            | 0.5 ALGO                                                                    |
| `MAX_BET_MICROALGO`              | No               | `500000n`            | 0.5 ALGO for v1. Contract also enforces 1% of live treasury                 |
| `TREASURY_MIN_BALANCE_MICROALGO` | No               | `2000000000n`        | 2,000 ALGO auto-pause threshold                                             |
| `CORS_ORIGINS`                   | No               | localhost:3000       | Comma-separated. Split via Zod transform                                    |
| `KEEPER_INSTANCE_ID`             | Yes (keeper)     | —                    | `primary                                                                    | standby`. Used as Redis SETNX lock value |
| `PLAUSIBLE_DOMAIN`               | No               | —                    | `fairground.xyz` for landing analytics                                      |
| `WALLETCONNECT_PROJECT_ID`       | Yes (game app)   | —                    | Register at cloud.walletconnect.com. Prefixed `NEXT_PUBLIC_` at build time  |

---

## MCP Servers

See `.mcp.json` for project MCP config.

| Server       | Purpose                                                                                                                                                 | Routing Rule                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `algorand`   | VRF beacon inspection (app 947957720), contract state reads, `simulate_transactions` before mainnet spend, competitor monitoring, algod/indexer queries | Always. Default `ALGORAND_NETWORK=localnet` during contract dev. Switch to `mainnet` for explicit inspection tasks |
| `context7`   | Verify real API signatures for algokit-utils, algosdk v3, use-wallet, Hono, Drizzle before writing code                                                 | Before implementing any call against a versioned library. Prevents version hallucinations                          |
| `playwright` | Visual QA of game dApp before deploy, competitor scraping (Alpha Arcade, Haystack PVP), proof-card rendering verification                               | Before any production deploy. Also for Alpha Arcade monitoring                                                     |
| `perplexity` | Algorand ecosystem competitive analysis, regulatory landscape, xGov grant opportunities                                                                 | Multi-source synthesis only — 10+ sources needed. Inherited from global `~/.claude/mcp.json`                       |
| `vestige`    | ALGO/USD price feeds for jackpot display and treasury balance USD conversion                                                                            | If `@goplausible/vestige-mcp` fails to load, fall back to WebFetch against `api.vestigelabs.org`                   |

`context7` and `perplexity` are inherited from global `~/.claude/mcp.json`. Do not duplicate in `.mcp.json`.

---

## Open Questions (Resolve Before Coding the Affected Area)

1. ~~**ARC-56 pipeline:**~~ **RESOLVED (2026-06-01).** `algokit-client-generator@6.0.1` accepts ARC-56 artifacts from `puyapy 5.8.1`. Clients generated successfully in `packages/sdk/src/clients/`. No `--output-arc32` fallback needed.
2. **TESTNET_BEACON_APP_ID:** Research cites `110096026`. Verify via `algorand` MCP before writing any testnet integration tests.
3. **`@goplausible/vestige-mcp` availability:** Verify `npx -y @goplausible/vestige-mcp` loads before relying on it.
4. **Geo-blocking implementation:** Cloudflare Workers (preferred, CDN layer) vs IP middleware in `packages/api`. Decision required before public announcement.
5. ~~**HouseTreasury architecture:**~~ **RESOLVED (2026-06-01).** Shared bankroll design: bets escrow in the game contract during pending, then swept to `house_treasury` on `resolve()`. Winners paid from treasury. `refund()` pays from the game contract directly — no treasury dependency. This keeps the 48-hour refund backdoor functional regardless of treasury pause state.
6. **Domain:** `fairground.xyz` vs `fairground.app` vs `fairground.bet`. The `.bet` TLD signals gambling to payment processors. `.xyz` is neutral.
7. **WalletConnect Project ID:** Register at cloud.walletconnect.com before any wallet integration testing. Required at build time.
8. **Proof card CDN timing:** `api.fairground.xyz/proof/:txnId` must be publicly accessible before the first game goes public — Twitter card previews require a live URL at tweet time.

---

## Skills Index

See `SKILLS.md` for the full index of project skills and when to invoke each.

## Sibling Projects

| Project             | Path                             | Relevance                                                                       |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `cometa-strategy`   | `~/dev/cometa/cometa-strategy`   | Design bible source: `research/algorand-degen-games-2026-05.md`                 |
| `prediction-market` | `~/dev/cometa/prediction-market` | Puya v5.0 patterns, box storage, AlgoKit workspace structure to reuse           |
| `metafarm-frontend` | `~/dev/cometa/metafarm-frontend` | `walletConnectService.ts` iOS relayer-wake hook to port into `useRelayerWake()` |

**Cometa VPS** (`hostinger`, 72.60.104.156): Fairground runs in a **separate Docker Compose stack** (`~/fairground/docker-compose.yml`) from Cometa (`~/cometa/docker-compose.yml`). Container crashes are isolated between the two stacks.
