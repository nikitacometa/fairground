# FairJackpot Release Runbook

> One release: coinflip **v2** (edge restructure + pot stream) + **fairjackpot** vault, deployed together.
> Design: `docs/design/fairjackpot-v1.md`. Spec: `cometa-strategy/strategy/fairground/26-fairjackpot-spec.md`.
> **STOP gate:** the founder confirms **500 vs 450 bps** before step 2. Mainnet money ops — simulate before every send.

## 0. Pre-flight (do not skip)

| Check                | Command / action                                                                                                                                                                                 | Pass                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Contracts compile    | `cd packages/contracts && algokit compile python smart_contracts/coinflip/contract.py --out-dir artifacts && algokit compile python smart_contracts/fairjackpot/contract.py --out-dir artifacts` | both ARC-56 written |
| Contract tests       | `cd packages/contracts && python -m pytest tests/ -v`                                                                                                                                            | 116 pass            |
| Monorepo green       | `make build && make typecheck && make lint` (node 22 PATH)                                                                                                                                       | all green           |
| Keeper tests         | `pnpm --filter @fairground/keeper test`                                                                                                                                                          | pass                |
| Migration present    | `packages/db/drizzle/0004_*.sql` exists (draws, draw_tickets, sessions.app_id)                                                                                                                   | yes                 |
| Deployer funded      | agent wallet `COOKHRI3…` ≥ ~110 ALGO (pot float 50 + app funding + seed + fees)                                                                                                                  | yes                 |
| v1 volume read       | record `coinflip_v1.total_volume` from app `3585680948` global state — drives the seed amount                                                                                                    | recorded            |
| Founder bps decision | 500 (primary) or 450 — set `HOUSE_EDGE_BPS` env for the deploy                                                                                                                                   | confirmed           |

The mnemonic is `DEPLOYER_MNEMONIC` (AlgoKit `from_environment("DEPLOYER")`) — the agent wallet. **Never print or commit it.**

## 1. Compute the seed at release time (not hardcoded)

The "virtual" pot players already paid into = **1% of all settled v1 volume**:

```
SEED = floor(coinflip_v1.total_volume * 100 / 10000)   # microALGO
```

Read `total_volume` live from app `3585680948` (algod `GET /v2/applications/3585680948`, global-state key `total_volume`). Pass it as `SEED_JACKPOT_POT_MICROALGO` in step 2. (≈4 ALGO at design time and growing — compute fresh.)

## 2. Deploy contracts (mainnet)

`packages/contracts/smart_contracts/deploy_config.py` orchestrates the full graph: HouseTreasury (existing — it redeploys a fresh one in a clean run, so for **mainnet reuse the live treasury `3584287403`** instead; see note) → FairJackpot → Coinflip v2 → register_game on treasury → set_game(1) on pot → seeds.

**Mainnet path (reuse the live treasury, deploy only pot + coinflip v2):** the canonical `deploy_config.py` creates a NEW treasury. For this release write a one-off `redeploy_v2.py` (pattern: the prior `redeploy_coinflip` flow) that:

1. `FairJackpot.create(admin=deployer, beacon_app_id=1615566206, first_close_ts=<next 20:00 UTC>)`; fund app with `APP_BASE_FUNDING + 50 ALGO` float.
2. `CoinflipContract.create(admin=deployer, treasury_app_id=3584287403, beacon_app_id=1615566206, min_bet=100000, max_bet=20000000, house_edge_bps=<500|450>, referral_bps=100, jackpot_app_id=<pot id>, jackpot_bps=150)` with `app_references=[pot_id]`; fund app account.
3. `HouseTreasury(3584287403).register_game(game_app_id=<coinflip v2 id>, pay=20500)` — grouped MBR payment. (Admin = agent wallet; it owns the live treasury.)
4. `FairJackpot.set_game(slot=1, game_app_id=<coinflip v2 id>)` with `app_references=[coinflip v2 id]`.
5. `FairJackpot.set_excluded(slot=1..N, ...)` for every house wallet: agent/admin, keeper, founder, and the dev test wallet. **≤ 8 slots — list them before deploy.**
6. `FairJackpot.deposit_pot(pay=SEED)` — the migrated v1 seed from step 1.
7. `CoinflipContract.set_max_bet(20_000_000)` — only if create used a smaller cap.

**Simulate every group before send** (`simulate()` with `allowUnnamedResources:true`). Record the new app IDs:

- `JACKPOT_APP_ID = ________`
- `COINFLIP_V2_APP_ID = ________`

> Treasury solvency: `max_payout_bps` on the live treasury is **1000 (10%)** — unchanged, fine for 1.90x coinflip payouts. The pot pays winners from its OWN balance, never via the treasury, so the treasury cap is irrelevant to draws.

## 3. Code registry + version bump

In `packages/types/src/version.ts`:

- `CONTRACTS.coinflip.appId = <COINFLIP_V2_APP_ID>`, `version: 2`, `deployedAt`.
- add `CONTRACTS.fairjackpot = { appId: <JACKPOT_APP_ID>, version: 1, deployedAt }`.
- `MAINNET_VRF_BEACON_APP_ID` unchanged.
- bump `PLATFORM_VERSION` **MAJOR → 1.0.0** (contract redeploy + new DB tables = breaking).
- `checkMainnetConfig`: the coinflip-id assertion now expects v2; the `jackpotAppId === 0n` warning clears once runtime.config is set.

Commit + push (lint/test gate runs). Frontend `NEXT_PUBLIC_COINFLIP_APP_ID` is **build-time baked** — it lives in `docker-compose.yml` build args (line 140), update to the v2 id there.

## 4. VPS config (manual, never rsynced)

SSH `hostinger`, edit `~/fairground/runtime.config` (gitignored flat env file):

```
COINFLIP_APP_ID=<COINFLIP_V2_APP_ID>
JACKPOT_APP_ID=<JACKPOT_APP_ID>
LEGACY_COINFLIP_APP_IDS=3585680948     # keep v1 resolvable for the 48h straggler window
HOUSE_TREASURY_APP_ID=3584287403       # unchanged
VRF_BEACON_APP_ID=1615566206           # unchanged
```

`JACKPOT_APP_ID` defaults to `0n` in the schema, so api/keeper containers that boot **before** this edit do not crash — they degrade (no draws, `/jackpot` 503). No split-brain: set this BEFORE rebuilding so the keeper picks the v2 cohort up immediately.

## 5. Deploy services (rsync + docker build)

DB migration runs automatically on keeper startup (advisory lock 427199) — `0004` creates `draws`/`draw_tickets` and adds `sessions.app_id`. **Deploy the API and keeper together** so the API never queries `draws` before the migration runs; if the API boots first and hits `/jackpot/draws` it returns a handled error, not a 500.

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
# sync changed packages + root manifests (lockfile MUST go if deps changed — none did this release)
rsync -az --exclude=node_modules --exclude=.next --exclude=dist --exclude=.astro --exclude=".e*" \
  packages/ apps/ hostinger:~/fairground/
rsync -az package.json pnpm-lock.yaml docker-compose.yml turbo.json hostinger:~/fairground/

# rebuild + recreate (api/keeper/proof changes need --no-cache; game must rebuild for the baked app id)
ssh hostinger 'cd ~/fairground && export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" && \
  docker compose build --no-cache fairground-api fairground-keeper-primary fairground-keeper-standby && \
  docker compose build fairground-game && \
  docker compose up -d --force-recreate fairground-api fairground-keeper-primary fairground-keeper-standby fairground-game'
```

Verify:

```bash
curl -s https://api.fairground.quest/status | python3 -m json.tool          # platformVersion 1.0.0, jackpotAppId set, coinflip v2 id
curl -s https://api.fairground.quest/jackpot | python3 -m json.tool          # ok:true, potMicroalgo = seed, epochId 1, nextDrawAt = first close
curl -s https://api.fairground.quest/stats | python3 -m json.tool            # contract.houseEdgeBps 500/450, payoutMultiplier 1.90, jackpotBps 150, no nulls
curl -s -o /dev/null -w "%{http_code}\n" https://app.fairground.quest/pot     # 200
docker compose -f ~/fairground/docker-compose.yml logs --tail=50 fairground-keeper-primary  # 'proxied:true', no JACKPOT crash, draw tick logging
```

## 6. Pause v1, drain stragglers

After v2 is confirmed live and a real v2 flip resolves end-to-end:

1. `CoinflipContract(3585680948).set_paused(true)` (admin = agent wallet). New flips route to v2 (browser uses the rebuilt baked id); v1 takes no new bets.
2. The keeper resolves v1 stragglers via `LEGACY_COINFLIP_APP_IDS` for 48h. The v1 48h `refund()` backdoor stays available regardless.
3. After 48h with zero pending v1 sessions, remove `3585680948` from `LEGACY_COINFLIP_APP_IDS` and restart keeper.

## 7. Internal test draw (throwaway instance — NOT the production pot)

Do **not** test on the production fairjackpot instance (epoch 1 of the real pot must not be a house test). Deploy a SEPARATE throwaway fairjackpot on mainnet (or testnet once `TESTNET_BEACON_APP_ID 110096026` is verified via algorand MCP) with a `first_close_ts` minutes away, register a dev coinflip, flip 1 ALGO from a dev wallet, then walk the full keeper path:

- `commit_draw` fires at close → `pending_epoch=1`.
- keeper waits `commit_round + 4`, simulates the beacon, computes hints, sends `resolve_draw`.
- verify: winner paid 70%, 10% rolled, `DrawResolved` event, `draws` + `draw_tickets` rows written, `GET /proof/draw/1` renders the PNG ≤ 60s, Redis `draw:resolved` published.
- kill the keeper mid-draw and restart → the draw completes exactly once (idempotent).
- confirm the dev/house wallet excluded: zero tickets, draw-excluded.

Tear the throwaway down. The production pot's epoch 1 stays clean for the first **public** draw.

## 8. Go-live timing + same-hour checklist

Time the launch so the **first public draw lands ~24h later at 20:00 UTC**. At launch hour:

- [ ] `@FairgroundHQ` bio edge number → "5% house edge / daily pot" (marketing-side; flag readiness).
- [ ] grep prod copy for hardcoded `3%` / `1.94` — landing (`fairground.quest`), app: `git grep -n "1.94\|3%\|300 bps"`. All live numbers pull from `/stats`.
- [ ] `/pot` page transparency block shows the live split from `/jackpot` params.
- [ ] geo-block status — **owner/Cloudflare job, OUT OF SCOPE here but still the public-launch gate** (per the wider launch audit; this release does not add geo logic by spec).

## 9. Rollback

If a draw or v2 flip misbehaves:

1. `CoinflipContract(v2).set_paused(true)` — stop new flips immediately.
2. Revert `docker-compose.yml` `NEXT_PUBLIC_COINFLIP_APP_ID` → `3585680948`, `runtime.config COINFLIP_APP_ID` → `3585680948`, drop `JACKPOT_APP_ID` (or set 0), unpause v1 (`set_paused(false)`), rebuild game + restart api/keeper. v1 is whole and untouched.
3. `FairJackpot.set_paused(true)` halts draws without touching accrual; player funds are never in the pot beyond the 1.5% cut. No player refund path is needed — the pot holds only house-edge money.
4. Investigate against the throwaway instance, never the live pot.

## 10. Post-launch watch (first week)

- DAW before/after; epoch-N→N+1 retention (the metric this feature exists to move).
- pot float: alert on `AccrueSkipped` events (MBR exhaustion) — top up the pot app balance.
- backstop spend; pot-size curve; heads-rate convergence (fairness proof).
- keeper draw latency: draw resolved + proof PNG ≤ 60s after 20:00 UTC.

---

### Quick reference — live IDs after this release

| Entity               | ID           | Notes                                            |
| -------------------- | ------------ | ------------------------------------------------ |
| Coinflip v2          | `________`   | edge 500/450 bps, jackpot 150 bps, set at deploy |
| FairJackpot          | `________`   | first_close_ts = next 20:00 UTC                  |
| HouseTreasury        | `3584287403` | unchanged, max_payout_bps 1000                   |
| VRF beacon           | `1615566206` | unchanged (947957720 is dead)                    |
| Coinflip v1 (paused) | `3585680948` | LEGACY for 48h, then drop                        |
