# Fairground — Task Board

Format: `FG-NNN | title | status | priority | notes`

Statuses: `todo` `in-progress` `blocked` `done`  
Priorities: `p0` (launch blocker) `p1` (launch required) `p2` (post-launch)

---

## Phase 0: Foundation (before any public announcement)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-001 | HouseTreasury Puya contract | `todo` | `p0` | First contract. Global pool, game registry, `max_payout_bps` default 100 (= 1% of live balance), `emergency_pause`. All game contracts call `get_available_balance()` via foreign app ref. Build before coinflip. |
| FG-002 | HouseTreasury contract tests | `todo` | `p0` | `algorand-python-testing` suite. Kill-the-mutant check required. Test solvency invariant: max payout enforced from live balance at resolve time, not at bet time. |
| FG-003 | Monorepo scaffold | `todo` | `p0` | pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .eslintrc.js, .prettierrc, .gitignore. All package.json stubs with pinned versions. Vitest workspace config. |
| FG-004 | @fairground/types package | `todo` | `p0` | Zod 4.4.3 schemas: `BetOutcome`, `GameId`, `SessionState`, `LeaderboardEntry`. BigInt rule: all microAlgo amounts, app IDs, round numbers as `bigint`. Zod env schemas for api and keeper. |
| FG-005 | @fairground/db package | `todo` | `p0` | Drizzle 0.45.2 schema. Tables: `bets`, `sessions`, `jackpot`, `leaderboard_snapshots`. `bets.amount_microalgo` and `bets.vrf_round` are `bigint`. Migrations run by keeper on startup. |
| FG-006 | Geo-block middleware | `todo` | `p0` | Hono middleware in `packages/api`. Blocks: US, UK, TH, ID, IN, BR. Required before any public announcement or Foundation RT. See `ops/geo-blocking.md` for implementation spec. |
| FG-007 | Docker Compose stack | `todo` | `p0` | `fairground-api`, `fairground-keeper-primary`, `fairground-keeper-standby`, `fairground-db` (postgres:16-alpine), `fairground-redis` (redis:7-alpine). Separate from Cometa stack at `~/cometa/docker-compose.yml`. |
| FG-008 | Block-secret-commit hook | `todo` | `p0` | Pre-commit hook that prevents staging files containing `HOUSE_SEED_WALLET_MNEMONIC` or any 25-word mnemonic pattern. |

## Phase 1: CoinFlip Contract

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-010 | CoinflipContract Puya contract | `todo` | `p0` | ~150-200 lines. Methods: `flip(salt_hash, referrer)`, `resolve(player)`, `refund()`. Box storage per player: key = address (32B), value = round + bet + salt + claimed (49B) = 35,000 microALGO MBR. Jackpot hook parameter present (rate can be zero at launch). Referral 0.5% rake baked in. |
| FG-011 | VRF beacon integration | `todo` | `p0` | `packages/sdk/src/vrf/beacon.ts`. `MAINNET_BEACON_APP_ID = 947957720n`. `targetBeaconRound(currentRound, delay=8n)`. `verifyFlipResult()`. `waitForBeaconRound()`. Verify testnet beacon app ID via algorand MCP before hardcoding. |
| FG-012 | Coinflip contract tests | `todo` | `p0` | `algorand-python-testing` suite. Test: flip commits correctly, resolve pays out 1.96x on win, resolve returns 0 on loss (minus house edge), refund available after 48h, referral rake sent correctly, duplicate resolve rejected (idempotency: beaconRound + walletAddress). Kill-the-mutant check required. |
| FG-013 | ARC-56 artifact + TS client gen | `todo` | `p0` | `puyapy compile` outputs `artifacts/coinflip.arc56.json`. Run `algokit generate client` to produce `packages/sdk/src/clients/CoinflipClient.ts`. Never edit generated files. Verify client-generator accepts ARC-56 input (open question — see docs/architecture.md). |
| FG-014 | House pool math verification | `todo` | `p0` | Confirm: 2,000 ALGO seed, 0.5 ALGO max bet, 2% house edge, 1% jackpot rake, 0.5% referral rake. Max payout per bet = 0.98 ALGO. Kelly criterion solvency at 10,000 simultaneous bets: document the calculation in code comments. |

## Phase 2: Leaderboard Contract

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-020 | Leaderboard Puya contract | `todo` | `p1` | Stub contract. Records wins/losses/volume per wallet across all games. Game contracts call it via inner app call on every resolution. Box storage per wallet. ARC-56 artifact + TS client gen follows same pattern as coinflip. |
| FG-021 | Leaderboard contract tests | `todo` | `p1` | Test: record_win updates state, record_loss updates state, cross-game totals accumulate correctly, unauthorized caller rejected. |

## Phase 3: Proof Card Engine

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-030 | @fairground/proof-card package | `todo` | `p0` | satori 0.26.0 + @resvg/resvg-js 2.6.2 + sharp 0.34.5. Templates: `VrfResultCard` (1600x900 landscape for Twitter, 1200x1200 square for Instagram). `theme.ts`: amber palette hardcoded for satori (no CSS vars). `outcomeColor('heads'|'tails'|'jackpot')`, `vrfProofColor()`. |
| FG-031 | Proof card Redis caching | `todo` | `p0` | Cache key: `proof:{txnId}`. TTL: permanent (proofs are immutable). API endpoint: `GET /proof/:txnId`. Generate on first request, serve from cache on subsequent. |
| FG-032 | Proof card CLI | `todo` | `p2` | `npx tsx src/cli.ts` for local testing. Accepts txnId and outputs PNG to stdout or file. |
| FG-033 | Twitter share intent URL | `todo` | `p1` | `https://twitter.com/intent/tweet?text=...&url={proof_card_url}`. Proof card endpoint must be publicly accessible before first game is public — deploy API to mainnet before launch. |

## Phase 4: API Server

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-040 | @fairground/api Hono server | `todo` | `p0` | Routes: `POST /games/:gameId/bets`, `GET /games/:gameId/state/:sessionId`, `GET /leaderboard`, `GET /proof/:txnId`, WS at `/ws`. pino logging. prom-client `/metrics`. Zod env validation at startup. |
| FG-041 | API geo-block middleware | `todo` | `p0` | Blocks US, UK, TH, ID, IN, BR. Required before any public announcement. See FG-006. |
| FG-042 | WebSocket game events | `todo` | `p1` | Hono WS handler subscribes to Redis pub/sub channel. Fans out keeper-published events (flip resolved, jackpot triggered) to connected clients. |
| FG-043 | API integration tests | `todo` | `p1` | Vitest. Test each route against LocalNet. Mock keeper events via Redis pub/sub. |

## Phase 5: Keeper Bot

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-050 | @fairground/keeper polling process | `todo` | `p0` | tsx 4.22.3. 4-second poll loop. Redis SETNX `keeperlock` (10s TTL, refreshed every 4s). Queries Postgres for sessions where `vrf_round <= current_round AND resolved_at IS NULL`. Calls contract `resolve()` via `CoinflipClient`. Updates `resolved_at`. Publishes to Redis pub/sub. |
| FG-051 | Keeper leader election | `todo` | `p0` | Redis SETNX with `KEEPER_INSTANCE_ID` as lock value. Primary holds lock; standby polls and promotes if lock expires. Two Docker Compose instances: `fairground-keeper-primary` and `fairground-keeper-standby`. |
| FG-052 | Keeper DB migration on startup | `todo` | `p0` | Keeper runs Drizzle migrations before entering the poll loop. Idempotent. |
| FG-053 | Keeper treasury balance monitor | `todo` | `p1` | Emit `PAUSE` event to Redis pub/sub if treasury live balance drops below `TREASURY_MIN_BALANCE_MICROALGO`. API WS fans out to clients. |
| FG-054 | Keeper redundancy test | `todo` | `p1` | Kill primary container, confirm standby promotes within 10s, confirm no double-resolve on in-flight sessions. |

## Phase 6: Wallet Connect

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-060 | @txnlab/use-wallet-react integration | `todo` | `p0` | `apps/game`. Supports: Pera (native SDK, not raw WC v2), Defly, Lute, Kibisis, Exodus. Register WalletConnect project ID at cloud.walletconnect.com. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` env var. |
| FG-061 | iOS relayer-wake hook | `todo` | `p1` | Port `visibilitychange` + `pageshow(persisted)` hook from `cometa/metafarm-frontend/src/services/walletConnectService.ts` as `useRelayerWake()` wrapping use-wallet manager. Prevents Pera connection drop on iOS backgrounding. |
| FG-062 | Mobile deep-link constants | `todo` | `p1` | Pera iOS: `perawallet-wc://`. Defly iOS: `defly-wc://`. Android: raw WC URI. In `packages/sdk` or `apps/game/lib/wallets.ts`. |

## Phase 7: Game dApp Frontend

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-070 | Next.js App Router scaffold | `todo` | `p0` | `apps/game`. Tailwind 4.3.0 dark amber palette. Layout, error boundary, loading states. |
| FG-071 | CoinFlip game canvas | `todo` | `p0` | Client component. Coin flip animation. VRF round countdown timer (~22s). Bet input (0.5 ALGO fixed in v1). Connect wallet gate. All txn group construction delegated to `@fairground/sdk` — no raw algosdk in this package. |
| FG-072 | VRF proof card share modal | `todo` | `p1` | Opens after result resolves. Shows proof card PNG. Twitter share intent button. Algoscan transaction link. |
| FG-073 | Leaderboard page (RSC) | `todo` | `p1` | Next.js RSC. Reads from API `/leaderboard`. Redis `ZREVRANGE` backend. No client bundle for this page. |
| FG-074 | Bet history page (RSC) | `todo` | `p1` | Per-wallet bet history from Postgres. RSC. |
| FG-075 | Jackpot display component | `todo` | `p2` | Real-time jackpot balance from treasury contract. WebSocket updates via API. Add in v1.2 after jackpot is enabled. |

## Phase 8: Leaderboard

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-080 | Cross-game leaderboard Redis ZSET | `todo` | `p1` | Keeper updates `ZADD leaderboard:weekly {score} {walletAddress}` on each resolve. Score = net ALGO P&L in microALGO (bigint serialized as string). Reset every Sunday 00:00 UTC via keeper cron. |
| FG-081 | Leaderboard API endpoint | `todo` | `p1` | `GET /leaderboard?limit=50`. Redis `ZREVRANGE` with scores. Response serializes bigint as string. |
| FG-082 | Weekly leaderboard prize payout | `todo` | `p2` | Keeper triggers payout from house treasury to top 10 wallets at weekly reset. Contract method call. Log payout transactions. |

## Phase 9: Jackpot Layer

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-090 | Jackpot accumulator in contract | `todo` | `p2` | 1% of every bet to jackpot box in CoinflipContract. VRF-triggered draw: `VRF_output mod 500 == 0`. Add in v1.2 after actual bets/day is measured. Contract already has jackpot hook parameter (rate can be zero at launch). |
| FG-091 | Jackpot balance API + WS | `todo` | `p2` | Keeper reads jackpot box balance every poll cycle. Publishes to Redis. API WS fans out. Frontend jackpot counter updates in real time. |
| FG-092 | Jackpot trigger test | `todo` | `p2` | AlgoKit LocalNet test that forces `VRF_output mod 500 == 0` by mocking beacon output. Verify funds transfer to winner. |

## Phase 10: Referral Rake-Share

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-100 | Referral parameter in flip() | `todo` | `p0` | Optional `referrer` ABI argument in `flip()`. If non-zero address: 0.5% of bet sent to referrer as inner ALGO transfer. Verify referrer has opted in before transfer fires (box check or algod account info). ~20 lines Puya. |
| FG-101 | Referral DB tracking | `todo` | `p1` | `bets.referrer_wallet` and `bets.referral_rake_bps` columns. Keeper writes on resolve. API endpoint: `GET /referrals/:wallet` returns total rake earned. |
| FG-102 | Referral link generation | `todo` | `p1` | `app.fairground.xyz/?ref={walletAddress}`. Frontend reads `ref` param, passes to `flip()` call. |

## Phase 11: Landing Page

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-110 | Astro landing scaffold | `todo` | `p1` | `apps/landing`. Astro 6.4.2 + Tailwind 4.3.0 + React 19 islands. Fonts: Geist Variable + Fraunces Variable. BaseLayout.astro: cursor ember trail (amber hue 55-70), grain overlay, scroll-reveal IO, JSON-LD, Plausible. |
| FG-111 | Landing sections | `todo` | `p1` | Hero, VRF explainer, Games (CoinFlip live, Minefield coming), Proof-of-fairness live stats, Leaderboard preview, FAQ, terminal easter egg (Konami code → VRF explorer). |
| FG-112 | OG image generation | `todo` | `p1` | Pre-build script using `@fairground/proof-card` to generate static OG images. Pattern from `prediction-market/landing`. |
| FG-113 | Plausible analytics | `todo` | `p1` | `PLAUSIBLE_DOMAIN=fairground.xyz` in Astro env. Track: page views, wallet connect events, bet submit events. No personal data. |

## Phase 12: Compliance / Geo-Block

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-120 | Compliance one-pager | `todo` | `p0` | See `docs/compliance.md`. Finalize before any public announcement. |
| FG-121 | Geo-block implementation | `todo` | `p0` | Cloudflare Workers geo-block (preferred over IP middleware — CDN layer, not bypassable by Accept-Language). Blocks: US, UK, TH, ID, IN, BR. Thai IP block is non-negotiable (Nikita's legal exposure in Bangkok). |
| FG-122 | TOS page | `todo` | `p1` | Crypto-only, no fiat. Age verification assertion. Geo-blocked jurisdictions listed. VRF verification instructions. |

## Phase 13: Keeper Bot Redundancy

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-130 | Two-keeper Docker Compose config | `todo` | `p0` | See FG-051. `restart: always` on both. SETNX leader election. |
| FG-131 | 48h player-triggered refund test | `todo` | `p0` | Kill both keeper containers. Confirm player can call `refund()` after 48h via any wallet without keeper involvement. Funds must never be locked. |
| FG-132 | Keeper crash + promote test | `todo` | `p1` | See FG-054. Document recovery runbook in `ops/`. |

## Phase 14: Price Client

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-140 | @fairground/price-client package | `todo` | `p2` | Port from `cometa/metafarm-frontend/src/providers/coinPriceProvider.ts`. 250ms debounce, 25-asset chunks, circuit breaker (5 failures → 30s cooldown). Replace axios with fetch. Used for ALGO/USD display in game UI and treasury balance monitoring. |

## V2: Algo Minefield

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| FG-200 | Minefield Puya contract | `todo` | `p2` | ~500-700 lines. `start_game(salt_hash, bomb_count, referrer)`, `reveal_cell(cell_index)`, `cashout()`, `forfeit()`, `refund()`. Box storage: session state (bomb count, revealed bitmap, multiplier, vrf_round). Single VRF commit covers all 25 cells — zero per-reveal oracle calls. Jackpot: 1% per bet, fires on `VRF mod 500 == 0`. See `docs/game-specs/minefield.md`. |
| FG-201 | Minefield VRF cell expansion | `todo` | `p2` | Deterministic cell-to-bomb assignment from single VRF output. `deterministicLayout(vrfOutput: Uint8Array, bombCount: number): number[]`. Verify: no two layouts are identical for distinct VRF outputs. |
| FG-202 | Minefield contract tests | `todo` | `p2` | Test: full board clear pays jackpot-eligible multiplier, bomb hit ends session (no payout), cashout fires inner ALGO transfer immediately, idempotency on double-reveal, refund after 48h keeper outage, solvency invariant holds across 1000 simulated sessions. |
| FG-203 | Minefield keeper integration | `todo` | `p2` | Session expiry: sessions older than 48h with no activity trigger refund. Jackpot trigger: keeper monitors jackpot box, fires payout when condition met. |
| FG-204 | Minefield frontend canvas | `todo` | `p2` | 5x5 grid. Cell reveal animation. Multiplier display (grows per safe reveal). Bomb count selector (1-10). Cashout button active after first safe reveal. Proof card modal on session end. |
| FG-205 | Minefield house pool seed | `todo` | `p2` | 5,000-10,000 ALGO required before any public announcement of Minefield. At ALGO = $0.118, that is ~$590-$1,180. Max bet: 20 ALGO. Enforced as 1% of live treasury balance at resolve time. Document solvency calculation. |

---

## Backlog (post-Minefield)

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| FG-300 | AlgoStreak badge layer on coinflip | `p2` | ARC-19 non-transferable on-chain streak badges. Add after CometaFlip v1.1. Not a standalone game. |
| FG-301 | ASA denomination (bet $GONNA/$BONEZ) | `p2` | CometaFlip v1.1 parameter change. Zero new infrastructure. Immediate meme community co-marketing. |
| FG-302 | Limbo mode on CoinflipContract | `p2` | Same VRF output reinterpreted as float. 2h additional code. Target multiplier T. |
| FG-303 | COMETA ASA token (buy-and-burn) | `p2` | Only after 500+ weekly active wallets. Fixed supply, zero emission. 20% of weekly house gross buys-and-burns from Tinyman. No revenue share. |
| FG-304 | xGov grant application | `p2` | After 10,000+ on-chain bets. Open-source contracts from day one. Retroactive Medium tier: 50,000-250,000 ALGO. |
| FG-305 | CometaCrash | `p2` | After CometaFlip confirms 50+ daily players. Highest-retention mechanic globally. Regulatory-complex. See design bible. |
| FG-306 | PackFight rooms | `p2` | Social acquisition mechanic. Build after leaderboard + player base established. |
| FG-307 | Memecoin Death Race | `p2` | Validate ASA partner (BonezAlgo DM) before writing contract. Permissionless tick design. |
| FG-308 | Curacao licensing | `p2` | Evaluate at $50,000+/month revenue. Not required at current bet size and solo operator scale. |
