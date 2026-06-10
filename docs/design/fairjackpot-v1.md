# FairJackpot v1 — Architecture Design

> Source spec: `cometa-strategy/strategy/fairground/26-fairjackpot-spec.md` (2026-06-10, founder-approved).
> Product name in UI: **Daily Pot**. Status: design → build. One release together with the edge restructure (500 bps / 1.90x).

## 0. Summary

Every settled flip streams 1.5% of the stake into an on-chain **pot vault** and accrues lottery
tickets (1 ticket per 1 ALGO cumulative wagered per epoch, minnow floor 1 ticket). Once a day at
20:00 UTC a permissionless VRF draw picks 1 winner (70%) + 5 runner-up slots (4% each); 10% rolls
over. No claim step — winners are paid by inner transactions in the draw call.

## 1. Decisions (with rationale)

| #   | Decision                                                                                                                                                                        | Rationale                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Pot vault = **new separate Puya app** (`fairjackpot`), HouseTreasury `3584287403` untouched                                                                                     | Treasury `max_payout_bps` is hard-capped at 10% — a 70%-of-pot payout cannot route through `pay_winner()`. Extending treasury = bankroll migration + re-register + timelock churn. The "existing 1% jackpotSeed" is a virtual display counter (computed in `/stats` from volume), not an on-chain balance — there is nothing to migrate except a one-time seed deposit. |
| D2  | Coinflip **v2 redeploy** (new app id): `HOUSE_EDGE_BPS 300→500`, new `JACKPOT_BPS=150`, `resolve()` adds inner payment (1.5% of stake → pot) + inner `accrue(player, bet)` call | Edge is a compile-time constant — redeploy is forced anyway (spec open question 1: NOT admin-settable). Accrual at the settlement layer, atomic with resolve: no keeper trust, "pot increases by exactly 1.5% of each settled bet" is on-chain verifiable.                                                                                                              |
| D3  | Ticket ledger = **append-only delta entries with cumulative sums**, paged boxes + per-player accumulator box per epoch                                                          | Updating a player's entry in place would shift every later prefix sum. Appending `(address, cum_after)` deltas keeps sums monotonic → binary-searchable. A player with k entries owns k ticket ranges whose total measure equals their tickets — win probability is exact.                                                                                              |
| D4  | Draw verification is **hint-based O(1)**, not on-chain iteration                                                                                                                | Keeper binary-searches off-chain and passes entry indexes; the contract recomputes `w_i = sha256(vrf ‖ i) mod total` and asserts `cum_after[hint-1] <= w_i < cum_after[hint]` reading at most 2 entries per slot. Permissionless + trustless (wrong hint reverts), no opcode-budget cliff, no iteration limits.                                                         |
| D5  | `recommit_draw()` recovery path                                                                                                                                                 | Beacon retains ~189 outputs (~70 min). A draw committed but not resolved in time is otherwise stuck forever (`must_get` panics). After `RECOMMIT_AFTER_ROUNDS` (~1000) anyone can re-commit to a fresh round.                                                                                                                                                           |
| D6  | Epoch increments at `commit_draw`, draw resolves epoch N−1                                                                                                                      | Flips settling in the commit→resolve window (~30 s) accrue into the new epoch — clean snapshot, no burned tickets.                                                                                                                                                                                                                                                      |
| D7  | Exclusion list + game registry = **4 global Account slots each**, not boxes                                                                                                     | Saves 2 box refs on every single resolve() (8-ref budget is already at 5-6). v1 has 1 game and ≤2 house wallets.                                                                                                                                                                                                                                                        |
| D8  | Pot app pays box MBR from its own operational float; `accrue()` has a graceful-degrade guard                                                                                    | A failed inner accrue would revert the player's resolve — pot MBR exhaustion must degrade (tickets skipped, payment kept, keeper alerts) rather than brick the game. Float is monitored; MBR is reclaimed by `cleanup()` of old epochs.                                                                                                                                 |
| D9  | Duplicate winners allowed across the 6 slots                                                                                                                                    | Uniqueness cannot be guaranteed (1 player epoch) and re-roll loops are budget-hostile. Weighted slots are honest: a whale can take multiple slots at exactly proportional probability. Documented for marketing.                                                                                                                                                        |
| D10 | Backstop top-up (25 ALGO) is keeper-side                                                                                                                                        | Keeper checks pot 10 min before draw; admin wallet sends `deposit_pot()`. `backstop_microalgo` stored in app global state for transparency, enforcement off-chain.                                                                                                                                                                                                      |
| D11 | API reads chain directly (cached), DB only for draw history                                                                                                                     | Pot/tickets/params come from app global state + box reads via algod REST (5-10 s Redis cache). `GET /jackpot?address` reads the player's box — exact + verifiable. Postgres `draws` + `draw_tickets` written by keeper post-draw (snapshot from on-chain boxes before cleanup).                                                                                         |
| D12 | Coinflip v2 also gets `set_admin()` + 6h timelock on beacon change                                                                                                              | Audit H-6 fix is free in a forced redeploy; `set_beacon_app_id` is a total-drain oracle-substitution vector — request/apply with `BEACON_TIMELOCK_ROUNDS` (~7,714).                                                                                                                                                                                                     |
| D13 | `house_edge_bps` / `jackpot_bps` / `referral_bps` are **create() args stored in global state**, logic reads state                                                               | Spec §1 hard requirement: split readable on-chain. Compile-time constants are invisible to algod. Bonus: founder decides 500 vs 450 at deploy time without recompile. No setters — immutable per app version.                                                                                                                                                           |
| D14 | `accrue(player, amount, jackpot_cut)` credits `pot_balance += jackpot_cut`                                                                                                      | A plain inner payment does not touch tracked state — without this the drawn pot stays at the seed value while real ALGO orphans in the address balance (review blocker). Coinflip computes the cut and passes it; tests assert formula equality.                                                                                                                        |
| D15 | Payout params snapshotted at `commit_draw` (`pending_winner_bps`, `pending_runner_bps`, `pending_runner_count`)                                                                 | `set_params` between commit and resolve must not alter a committed draw — provably-fair means the split is fixed at commit time. `resolve_draw` asserts `hints.length == 1 + pending_runner_count`.                                                                                                                                                                     |
| D16 | Exclusion re-checked per winner slot in `resolve_draw`; excluded slot's payout → rollover                                                                                       | Exclusion at accrue-time only is bypassable if a house wallet accrued before `set_excluded`. 8 global slots (not 4): admin/keeper, founder wallet, dev test wallet + headroom.                                                                                                                                                                                          |
| D17 | MBR-float griefing (≈8.3 ALGO spawns ~1.2k fake wallets to exhaust ticket-box float) = **accepted risk v1**                                                                     | Player-funded ticket MBR is not cleanly possible (coinflip cannot read pot boxes at flip() time to know if it's a first-flip-of-epoch). Mitigation: 50 ALGO float, `AccrueSkipped` event + keeper alert, cleanup reclaims MBR every epoch, top-up is cheap. Attack has zero profit and recurring cost. Revisit in v1.1.                                                 |

## 2. Contract: `fairjackpot` (Puya)

### Global state

```
admin: Account
beacon_app_id: UInt64
epoch_id: UInt64                 # current accruing epoch (starts 1)
epoch_close_ts: UInt64           # unix ts of next 20:00 UTC boundary
epoch_total_tickets: UInt64      # tickets in current epoch
epoch_entry_count: UInt64        # delta-entries appended in current epoch
pot_balance: UInt64              # microALGO earmarked for the CURRENT pot (credited by accrue/deposit_pot/rollover)
last_rollover_microalgo: UInt64  # rollover of the last resolved draw (API display)
# pending draw (zero when idle) — payout params snapshotted at commit (D15)
pending_epoch: UInt64
pending_commit_round: UInt64
pending_pot: UInt64
pending_total_tickets: UInt64
pending_entry_count: UInt64
pending_winner_bps / pending_runner_bps / pending_runner_count: UInt64
# params (admin-settable, apply to FUTURE commits only)
winner_bps: UInt64 = 7000
runner_bps: UInt64 = 400
runner_count: UInt64 = 5         # set_params asserts 1 <= runner_count <= 5, winner+runner*count <= 10000
backstop_microalgo: UInt64 = 25_000_000
paused: UInt64
# registries (global slots — saves box refs on the per-flip hot path, D7/D16)
game_1..game_4: Account          # authorized accrue() callers (app addresses)
excluded_1..excluded_8: Account  # ticket-excluded house wallets
```

### Boxes (raw op.Box, manual keys — full control of bytes + MBR)

| Box                | Key                                 | Value                                                 | MBR          |
| ------------------ | ----------------------------------- | ----------------------------------------------------- | ------------ |
| Player accumulator | `"t"+itob(epoch)+addr` (41 B)       | `wagered(8)+tickets(8)` (16 B)                        | 25,300 µA    |
| Ledger page        | `"p"+itob(epoch)+itob(page)` (17 B) | 102 entries × `addr(32)+cum_after(8)` = 4,080 B fixed | 1,641,300 µA |

`ENTRIES_PER_PAGE = 102`. Entry `e` lives at page `e // 102`, offset `(e % 102) * 40`.

### Methods

- `create(admin, beacon_app_id, first_close_ts)`
- `accrue(player: Address, amount: UInt64, jackpot_cut: UInt64)` — caller must be a registered game (Txn.sender == game app address). **`pot_balance += jackpot_cut` first (D14)** — the cut payment and this credit are atomic within the same resolve(). If player excluded → return (payment kept, no tickets). `wagered += amount`; `target = max(1, wagered // 1_000_000)`; `delta = target - issued`; if delta > 0 → append `(player, epoch_total_tickets + delta)` to page (creating page box when needed), bump globals, update player box. Graceful-degrade: if spendable balance < MBR needed + `FLOAT_RESERVE` (5 ALGO, typing.Final), skip ticket write (keep payment), emit `AccrueSkipped` event — a failed accrue must never revert the player's flip resolve.
- `deposit_pot(pay: gtxn.Payment)` — anyone; credits `pot_balance` (backstop top-ups, donations, seed migration).
- `commit_draw()` — permissionless. Requires `latest_timestamp >= epoch_close_ts`, `pending_epoch == 0`, not paused. If `epoch_total_tickets == 0`: advance epoch + close*ts (pot rolls implicitly), emit, return. Else snapshot pending*_ **including winner/runner payout params (D15)**, zero current accruals, `epoch_id += 1`, `epoch_close_ts += 86400 _ ((latest_ts - close_ts) // 86400 + 1)`(skips missed days), commit to`ceil8(round + 8)`.
- `resolve_draw(hints: arc4.DynamicArray[arc4.UInt64])` — permissionless. **Asserts `pending_epoch != 0` first** (else division-by-zero panic on stale calls), then `round >= pending_commit_round + 4`, then `hints.length == 1 + pending_runner_count`. `ensure_budget(...)` with GroupCredit — keeper sets txn fee ≈ 15,000 µA (beacon call + 6 payments + ~3 OpUp + headroom). Reads beacon `must_get(pending_commit_round)`. For slot i in 0..pending_runner_count: `w_i = btoi(sha256(vrf ‖ itob(i))[:8]) mod pending_total_tickets`; verify hint range with **explicit `hint == 0` branch (lower bound = 0, no `cum_after[-1]` read — UInt64 underflow blocker)**; re-check winner against excluded slots (D16) — excluded slot's payout joins rollover; pay via inner payments (receivers exempt from foreign-account limits per AVM 1.1 — no account refs needed). Remainder (incl. integer dust + excluded slots) → `pot_balance`, `last_rollover_microalgo` set. Clear pending. `arc4.emit(DrawResolved)` with the FULL record (epoch, pot, rollover, total_tickets, commit_round, vrf_round, beacon_output, winner+payout, runners+payout) — the keeper's crash recovery reconstructs the DB row from this event alone, so `cleanup()` of the drawn epoch is allowed only after the DB row is written.
- `recommit_draw()` — permissionless. Requires `pending_epoch != 0` and `round > pending_commit_round + RECOMMIT_AFTER_ROUNDS (1000)`. Re-targets `pending_commit_round = ceil8(round + 8)`.
- `cleanup(epoch, keys...)` — deletes player/page boxes for epochs ≤ `epoch_id - 2`, reclaims MBR into the app balance.
- Admin: `set_params(winner_bps, runner_bps, runner_count, backstop)` (assert `winner + runner*count <= 10000`, `runner_count <= 5`), `set_game(slot, app_id)`, `set_excluded(slot, addr)`, `set_paused(bool)`, `set_admin(addr)`, `set_beacon_app_id` (create-time/localnet only — guarded by timelock like coinflip v2 or admin+pause).
- `noop()` — ref/budget carrier for group composition.
- Readonly: `get_player_tickets(epoch, addr)`, `get_draw_state()`.

### resolve() integration (coinflip v2)

Order inside coinflip `resolve()`: referral (1%) → **jackpot cut (1.5%) payment to pot + `accrue(player, bet, cut)` abi_call** → sweep `bet − referral − cut` to treasury → `pay_winner` (1.90x) on win → MBR return → del flip box. The bps values are global state set at create() (D13); resolve() computes from state. Keeper `extraFee` 7000 → **10,000** µA (2 extra inners + headroom). Box refs in the single resolve txn: flip box, treasury game box, pot player box, pot current page, pot next page (boundary case) = 5 ≤ 8 — **no carrier txn needed for flips** (confirmed: inner-payment receivers don't consume account refs). The keeper must fetch pot global state (`epoch_id`, `epoch_entry_count`) once per batch tick to compute the pot box keys (wrong epoch/page = `invalid box reference`), plus keep `populateAppCallResources` as a safety net.

## 3. Keeper

New `packages/keeper/src/jackpot.ts`. **Runs inside the existing `tick()` body** (after `resolveExpiredSessions`), gated by `lastJackpotCheckAt` ≥ 60 s — a second `setInterval` would bypass the `tickRunning` reentrancy guard and race the draw state machine (review high):

1. **Pre-draw (T−10 min):** if `pot_balance < backstop_microalgo` → `deposit_pot()` top-up from house wallet. Check the wallet's spendable balance first; log.error with deficit if insufficient (draw proceeds with a smaller pot — backstop is keeper-side, not enforced on-chain).
2. **At/after `epoch_close_ts`:** call `commit_draw()`.
3. **Poll:** wait for `pending_commit_round + 4`, binary-search hints off-chain from page boxes, compose group `[resolve_draw(hints), noop, noop]` — carriers exist for **box refs only** (up to 12 page refs when hints sit on page boundaries: for each hint h also declare page((h−1)//102) when h > 0). resolve_draw txn fee ≈ 15,000 µA.
4. **Post-draw:** parse `DrawResolved` event → write `draws` + `draw_tickets` rows (tickets snapshot read from chain boxes BEFORE cleanup) → render draw proof PNG (pre-bake into Redis `proof:draw:{epoch}` — deterministic ≤60 s SLA) → publish WS event. Only then `cleanup()` the drawn epoch's boxes.
5. **Recovery:** state machine restartable at any step (contract state is the source of truth; DB row is journal). On `resolve_draw` revert: if `round > pending_commit_round + RECOMMIT_AFTER_ROUNDS` → call `recommit_draw()` and resume polling (mirrors resolver.ts beacon-expiry logic). Crash-after-resolve-before-DB: reconcile from the `DrawResolved` event via indexer logs. Alert (log error) if unresolved > 15 min past close.

Idempotency: contract reverts duplicate commits/resolves with clean assert messages; keeper treats "already done" as success (same reconcile philosophy as flips).

**v1→v2 flip transition (review blocker):** add `app_id` bigint column to `sessions` (backfill v1 id); keeper resolves cohorts per app id with a `LEGACY_COINFLIP_APP_IDS` env (comma-separated) during the 48 h window; `reconcileResolvedBet` receives the session's app id for its indexer search. Without this every pending v1 flip would be submitted against v2 and corrupt its DB state.

## 4. API (`/jackpot` router, public, read-only, bigints as strings)

- `GET /jackpot` → `{ potMicroalgo, epochId, nextDrawAt, totalTickets, params { jackpotBps, winnerBps, runnerBps, runnerCount, backstopMicroalgo }, rolloverMicroalgo (last_rollover global), pendingDraw|null, lastDraw|null }`. All read from chain state — `jackpotBps` comes from coinflip global state (D13), never hardcoded. Redis 5 s.
- `GET /jackpot?address=X` → adds `myTickets`, `myWageredThisEpoch` (live box read, 5 s cache per address).
- `GET /jackpot/draws?limit=30` → draw history from Postgres (winner `{address, nfd, payout}`, runnersUp[] with NFDs — snapshot NFDs into the draws row at keeper write time, live-resolve as fallback; vrfRound, txnIds, proofUrl).
- `GET /proof/draw/{epochId}` → satori PNG (`DailyDrawCard` template), permanent Redis cache like flip cards.
- `/stats` additions: `jackpot { potMicroalgo, nextDrawAt, epochId, lastDrawWinner }`, contract block gains `jackpotBps`, edge fields go 500/1.90. Replace `jackpotSeedMicroalgo` derivation with real pot state. **Plus stale-cache fallback for on-chain config (fixes the `/stats` nulls acceptance item).**

## 5. Frontend (amber-terminal system, no new design language)

1. `PotBar` client component (replaces decorative `JackpotTicker`): pot count-up, `next draw 04:12:33` countdown to 20:00 UTC, `your tickets: N` when connected. Mounted on play + feed + leaderboard + pot + **proof permalink** pages (spec: "every page"; header is per-page by existing convention).
2. `/pot` page: hero pot number, countdown, 3-line how-it-works, my tickets, draw history table (proof card + allo.info links + VRF round), live transparency block (split percentages from API).
3. Post-flip toast at `CoinflipGame.tsx` resolution hook: `+N tickets · pot: X ALGO`.
4. Post-draw banner (24 h) on play page: "yesterday's pot: X ALGO → wallet.algo · verify".
5. NavTabs gains `pot` tab (4 files).

## 6. DB

- `draws`: epoch_id (bigint unique), state, pot/rollover/payout amounts (bigint mode:'bigint'), total_tickets, commit_round, vrf_round, beacon_output, winner_address, runners_up jsonb, commit/resolve txn ids, proof_card_url, drawn_at, created/updated_at.
- `draw_tickets`: draw_id FK, wallet_address, tickets, wagered_microalgo (keeper snapshot from chain boxes pre-cleanup; powers analytics §7).

## 7. Release shape (one release)

1. Contracts: `fairjackpot` deploy + coinflip v2 deploy (bps as deploy args — founder picks 500 or 450 here, pot wiring, set_admin, beacon timelock) + `register_game(coinflip_v2)` on treasury + `set_game(1, coinflip_v2)` on pot + `set_excluded(house wallets)` + pot float funding (50 ALGO) + seed migration deposit — **computed at release time as `coinflip_v1.total_volume × 100 // 10_000` read from chain (≈4 ALGO and growing), not hardcoded** + `set_max_bet(20 ALGO)` on v2.
2. `CONTRACTS` v2 entries + PLATFORM_VERSION 1.0.0 + env (`JACKPOT_APP_ID` with **default 0n** — a required Zod field would crash every container booting before runtime.config update; `checkMainnetConfig` warns on 0n at mainnet) + new `COINFLIP_APP_ID` in runtime.config + game image rebuild (`NEXT_PUBLIC_COINFLIP_APP_ID` is baked at build).
3. Old coinflip v1 `3585680948`: `set_paused(true)` after v2 live; keeper keeps resolving v1 stragglers for 48 h via `LEGACY_COINFLIP_APP_IDS`, refund backdoor stays.
4. Internal test draw on a **separate throwaway fairjackpot instance** (short `first_close_ts`) — never on the production instance, so epoch 1 of the real pot isn't a house-test draw in public history. First public draw timed ~24 h post-launch at 20:00 UTC.
5. Same-hour: grep + purge any hardcoded `3%`/`1.94` in copy; bio update is marketing-side.

Founder confirms 500 vs 450 bps at release (one-line change + recompile).

## 8. Out of scope (per spec)

Geo-blocking (explicitly excluded), token, multi-game accrual beyond registry slots, webhook push (social loop polls).
