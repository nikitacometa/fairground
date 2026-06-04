# Fairground Pre-Launch Audit — 2026-06-04

Multi-agent audit (35 agents: 9 dimension auditors + adversarial verification of every critical/high finding). 105 raw findings, 26 adversarially verified. This file is the working backlog; status column tracks resolution.

## Verdict

The surface is solid. Playwright across landing + game + leaderboard on desktop (1440) and mobile (390): **zero console errors, no React #418, no layout overflow, the full loop works end-to-end on both viewports**, the amber/terminal aesthetic is cohesive, the win moment lands. The live production site is **not broken** — the dead-beacon and wrong-CORS defaults in the repo are silently overridden by `runtime.config` on the VPS.

Launch is held by three things and one structural cluster:

1. **Geo-block is not actually live** (legal blocker — operator in Bangkok, Thai block non-negotiable).
2. **Treasury is empty (~4 ALGO)** — every real win reverts until seeded.
3. **Proof card lies** — beacon hash is 64 zeros and the coin side is hardcoded, undermining the one marketing asset.
4. **Config-drift landmine cluster** — repo defaults diverged from prod runtime; any fresh deploy / DR rebuild silently breaks.

The fee budget on `resolve()` is **safe** (8000 microALGO covers the 7000 worst case — win+referral, 6 inner txns). Idempotency / double-payout is clean. The 48h refund backdoor works independently of treasury pause. NFD forward-verification is correct. The keeper lock is correct.

## What is NOT a problem (verified, do not touch)

| Claimed issue                            | Verdict                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve()` underfunds inner-txn fees    | **Refuted** — keeper sends `extraFee: 7000` → pool 8000 ≥ 7000 worst case (`resolver.ts:139`). Comment miscounts (says 4 inner, real max 6); behavior fine. |
| `/metrics` not geo-blocked               | **Refuted** — Hono applies `app.use('*')` at dispatch, so `/metrics` IS geo-blocked. (Separate real issue: `/metrics` has no auth.)                         |
| "Player picks tails + wins → wrong card" | **Premise refuted** — no player-pick exists on-chain; outcome is purely `sha256(beacon‖salt)%2`. Underlying relabel issue still stands (see H-5).           |
| Double-payout via replay/front-run       | **Refuted** — box-delete idempotency guard reverts any duplicate `resolve()`.                                                                               |
| Player funds can be stuck/lost on chain  | **Refuted** — 48h `refund()` pays from coinflip's own balance, works even when treasury is paused.                                                          |

---

## Launch blockers (P0 — before any public announcement)

### B-1 · Geo-block is a spec, not a deployed control — CRITICAL

`ops/geo-blocking.md` is a document; the Cloudflare Worker is not deployed. DNS for `fairground.quest`, `app.`, `api.` resolves **directly** to the VPS (72.60.104.156) — no Cloudflare, no `CF-IPCountry`. The API middleware (`geo-block.ts:20`) reads a header that nothing injects → blocks nothing, and is header-spoofable even if it were behind CF. Worse: the **game dApp and landing have zero geo-block at all** — a player in TH/US/UK loads and plays. Owner is physically in Bangkok; CLAUDE.md calls the Thai block "non-negotiable."

- **Fix:** enable Cloudflare orange-cloud proxy for all 4 records → deploy the Worker on `app.` + `api.` + landing → block US/UK/TH/ID/IN/BR → test `curl -H 'CF-IPCountry: TH'`.
- **Side effect to handle:** once CF blocks by country, `GET /proof/:txnId` gets blocked too → Twitter card previews break worldwide. **Exempt `/proof/*` from the geo-block** (proof cards are public marketing, not gameplay). (`ux` finding re: 451 on shared tweets.)
- **Owner-handled** per prior session, but this is THE gate. Effort: M.

### B-2 · Treasury thin (~4.28 ALGO) — HIGH ops gate (corrected from CRITICAL)

**Correction (verified on-chain 2026-06-04):** the deployed `max_payout_bps` is **1000 (10%)**, not the contract default of 100 (1%) the auditors assumed. Recomputed: spendable ≈ 4.12 ALGO → single-payout cap ≈ **0.41 ALGO**; a 0.1-ALGO win pays 0.194 ALGO < 0.41 → **wins currently settle.** The "every win reverts" reading was wrong. The real risk is buffer depth: the 4-ALGO float absorbs only ~20 net wins and cannot back a higher `max_bet`.

- **Fix:** seed to **100–200 ALGO** before the public push (volume headroom + room to raise `max_bet`). Not a first-win blocker.
- **Owner-handled** ("пополню завтра-послезавтра"). Effort: S (a transfer).
- Related gap: keeper **auto-pause on low treasury is not implemented** (H-8) — until then, depletion is silent.

### B-3 · Config-drift landmine cluster — HIGH (insurance, do now)

Repo defaults diverged from the live `runtime.config`. Prod survives by override; a fresh Docker Compose / DR rebuild silently breaks. All cheap, all mechanical:

| ID   | Issue                                                       | Location                                         | Fix                                                    |
| ---- | ----------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| B-3a | `VRF_BEACON_APP_ID` defaults to dead `947957720n`           | `types/src/schemas/env.ts:16`, `.env.example:50` | → `1615566206n`; add startup assert if mainnet+dead-id |
| B-3b | `CORS_ORIGINS` defaults to `fairground.xyz`                 | `types/src/schemas/env.ts:22`                    | → `fairground.quest` domains                           |
| B-3c | `runMigrations()` never called — fresh DB gets no schema    | `keeper/src/migrate.ts:32`, `index.ts`           | `await runMigrations()` first in `runLoop()`           |
| B-3d | `runtime.config` not in `.gitignore` — mnemonic commit risk | `.gitignore`                                     | add `runtime.config`                                   |
| B-3e | `safety-state.md` stale (says testnet/not-deployed)         | `ops/safety-state.md`                            | rewrite to live-mainnet state                          |

---

## Real bugs (P1 — fix in the first hardening pass)

### High

| ID  | Bug                                                                                                                                                                                                | Location                                                        | Fix                                                                                                                                                                | Eff |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| H-1 | **Proof card beacon hash = 64 zeros** — keeper never writes `vrfOutput`; every card shows `00…00`. Kills the "verifiable by anyone" claim on the hero artifact.                                    | `keeper/src/resolver.ts:145-148`, `api/src/routes/proof.ts:127` | After `resolve()`, fetch the inner `must_get()` return (indexer/pending-txn), write `bets.vrfOutput`. No contract redeploy.                                        | M   |
| H-2 | **`recordBet` failure shows "funds were not wagered" — false.** On-chain flip confirmed but DB write fails → user told funds are safe (they're escrowed), retries → "already has an active flip."  | `CoinflipGame.tsx:281-284, 820-821`                             | Split try/catch: after `sendFlip` confirms, persist `{txnId,commitRound,addr}` to localStorage, retry `recordBet`, show "bet placed, syncing…" not "funds safe."   | M   |
| H-3 | **Keeper DB-crash-window desync.** Crash after on-chain confirm but before bet update → bet stuck `pending` forever; staleness sweep can't catch it (session already past `resolving`).            | `keeper/src/resolver.ts:132-180`                                | Wrap session+bet updates in one `db.transaction`. Add a chain-reconcile sweep: for `resolved` sessions with `pending` bets, re-derive outcome from `resolveTxnId`. | M   |
| H-4 | **Beacon-expiry retry storm → permanent `failed`, no escalation.** Session older than ~70 min beacon retention → `must_get()` panics forever → 5 retries → `failed`, no alert, no refund guidance. | `keeper/src/resolver.ts:194-204`                                | If `currentRound - commitRound > 1200`, skip send, set state `beacon_expired`/`refundable`, emit WS + operator alert.                                              | M   |
| H-5 | **Proof card shows wrong/meaningless coin side** — win always "HEADS", loss always "TAILS". No player-pick is stored on-chain, so the side is arbitrary.                                           | `api/src/routes/proof.ts:124`, `VrfResultCard.tsx:63-70`        | Simplest: drop heads/tails, show `WON`/`LOST`. Better: add `playerPick` column end-to-end (bet POST → DB → card).                                                  | S–M |
| H-6 | **Single admin hot key = treasury drain risk.** Admin controls pause + `emergency_withdraw` (uncapped `amount`, 48h timelock) AND is effectively the keeper hot key.                               | `house_treasury/contract.py:179-199`, `resolver.ts:92`          | Separate admin from keeper signer (keeper only needs fee ALGO — `resolve()` is permissionless). Move admin to a cold/multisig before seeding capital.              | M   |
| H-7 | **No monitoring/alerting.** Keeper death, treasury drain, failed resolves all invisible until a player complains 48h later. `/health` and `/leaderboard` return 200 even when keeper is dead.      | `keeper/src/index.ts`, `api/src/app.ts:55`                      | Heartbeat (keeper writes `last_tick` to Redis; `/health` checks freshness) + treasury-balance alert + failed-resolve alert.                                        | M   |
| H-8 | **Keeper auto-pause not implemented** despite design doc + `safety-state.md` + CLAUDE.md claiming "auto-pause at 2000 ALGO." `TREASURY_MIN_BALANCE_MICROALGO` is read zero times.                  | `keeper/src/resolver.ts` (whole)                                | Each tick: read treasury balance; below floor → call `pause()` + alert.                                                                                            | M   |

### Medium (correctness / robustness)

| ID   | Issue                                                                                                  | Location                                    | Fix                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| M-1  | `amountMicroalgo` trusted from client (no on-chain check) → leaderboard/proof poisoning (no fund loss) | `bets.ts:24,44-45`                          | Bounds-check against `MIN/MAX_BET`; later cross-check the on-chain flip amount |
| M-2  | `POST /bets` not idempotent — retried `txnId` creates duplicate rows                                   | `bets.ts:39-53`                             | `UNIQUE(commit_txn_id)`; upsert on conflict                                    |
| M-3  | Bet+session insert not atomic → orphan bet on partial failure                                          | `bets.ts:40-73`                             | wrap in `db.transaction`                                                       |
| M-4  | Missing index `(wallet_address, resolved_at)` — `computeWinStreak` full per-wallet sort                | `db/src/schema.ts`                          | `CREATE INDEX … ON bets (wallet_address, resolved_at DESC)`                    |
| M-5  | Missing index `(state, commit_round)` — keeper poll seqscan                                            | `db/src/schema.ts`                          | composite/partial index on pending poll                                        |
| M-6  | Leaderboard `/live` P&L formula wrong for winners (double-counts stake)                                | `leaderboard.ts:53-56`                      | net = Σ(net_payout − amount) over wins − Σ(amount) over losses                 |
| M-7  | `proofCardUrl` stored relative → breaks external share / Twitter card                                  | `resolver.ts:176`                           | store absolute `https://api.fairground.quest/proof/{txn}`                      |
| M-8  | WS: no connection limit, no flood guard, unbounded clients Set                                         | `ws.ts:37,56`                               | cap connections, drop on backpressure, clean up on close                       |
| M-9  | nginx rate-limit zones referenced but never defined                                                    | `ops/nginx/fairground.quest.conf:59,97,139` | define `limit_req_zone` or remove the refs                                     |
| M-10 | No `/status` route — CLAUDE.md health check 404s                                                       | `api/src/app.ts:55`                         | add `/status` → `{network, version}`                                           |
| M-11 | `/metrics` public, no auth                                                                             | `app.ts:47-51`                              | bearer-token or nginx allowlist                                                |
| M-12 | NFD lookup in proof endpoint has no timeout — nf.domains hang blocks request                           | `proof.ts:109`                              | `AbortController` 2s timeout                                                   |
| M-13 | Queue-next fires before the share modal is dismissed → suppresses the viral loop                       | `CoinflipGame.tsx:477-496`                  | hold auto-advance until modal closed or "share & continue"                     |
| M-14 | Wallet disconnect between queue-fire and armed-flip → silent drop to idle                              | `CoinflipGame.tsx:491-496`                  | guard + toast "wallet disconnected, queued flip cancelled"                     |
| M-15 | Mute button 16×22px — untappable on mobile                                                             | `CoinflipGame.tsx:505-512`                  | ≥44px tap target                                                               |
| M-16 | No Postgres backup — losing the DB loses all proof cards + leaderboard                                 | `docker-compose.yml`                        | nightly `pg_dump` to off-box storage                                           |
| M-17 | Stale-session recovery resets `retryCount` instead of incrementing                                     | `resolver.ts:57-68`                         | increment, not reset                                                           |

### Low (polish — batch later)

`outcome` column unconstrained text (add CHECK) · leaderboard `/live` full GROUP BY seqscan (add index + cache) · `/state/:sessionId` no ownership check · NFD cache no expiry refresh · referral copy "0.5%" vs 1% paid (`CoinflipGame.tsx:543`) · `referralRakeBps` DB writes 25 vs 100 (`bets.ts:51`) · stale "2% edge" comments after 3% change · no `simulate()` before keeper `send()` · jurisdiction disclaimer removed from footer with no replacement · landing title uses `--` not `—` · game outcome not announced to screen readers · no CI (tests/lint not enforced on push).

---

## Mechanics & design — what's missing, what to add

The contracts are sound, the brand is sharp, the solo experience is well-built. The gaps are social proof, retention loops, and proof-card truthfulness.

| Rank | Add                                                                                                                                                                                                                                                                        | Why (ROI)                                             | Effort |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| ★1   | **Wire the live bet feed.** `ws.ts` already publishes `bet:resolved`; keeper already publishes; frontend has zero WS client. A scrolling feed of others' flips during the 30s wait turns the loneliest moment into ambient social proof — the Aviator retention mechanism. | Highest impact / lowest effort — server side is done. | S      |
| ★2   | **Make the proof card true** (H-1 hash + H-5 side). The card is the marketing budget; a 64-zero hash is a public credibility hole.                                                                                                                                         | Protects the entire "provably fair" thesis.           | M      |
| 3    | **Reanimate referral.** Fix copy (0.5%→1%), fix DB bps (25→100), add a referrer earnings widget (cumulative ALGO earned). Today it's invisible → never triggers organically.                                                                                               | Turns a dead mechanic into a viral loop.              | S+M    |
| 4    | **Jackpot counter (off-chain v1).** Schema table exists, stats hardcode `0`. Accumulate 1% of resolved bets, display a live ticker, trigger on a VRF-seeded 1-in-N. Design bible calls it "the cheapest retention add-on."                                                 | Retention hook; deferred until treasury seeded.       | M      |
| 5    | **Server-authoritative streak.** UI streak is localStorage-only (resets across devices); `computeWinStreak` already exists server-side. Add `GET /streak/:address`, hydrate on connect.                                                                                    | Fixes streak-at-risk tension for multi-device.        | S      |
| 6    | **Loss-path re-entry.** Loss is a dead end ("sha-256 was correct, you were not"). Add an on-brand "run it back" CTA to keep the loop alive.                                                                                                                                | Reduces churn on the most common outcome.             | S      |

**Economics:** 3% edge / 1.94x is defensible on a thin treasury but undercuts the design bible's 2% / 1.96x target. Hold 3% now; **publicly commit** to dropping to 2% above 500 ALGO treasury — frames the higher edge as capital-tied, not greed.

**Strategic clock:** the design bible says coinflip-without-a-meta-loop is a **6-8 week tourist product**; Algo Minefield is the retention game and has **no start date**. Set the Minefield kickoff trigger (treasury crossing 2000 ALGO) before the public announcement, or daily-actives decay before the next game exists to catch them.

---

## Structural root cause

Most P0/P1 config items share one cause: **repo defaults drifted from the live `runtime.config`, with no CI and no reproducible deploy to catch it.** Fix the cluster (B-3) AND the systemic gap:

- Align all defaults to prod (`.quest`, live beacon, real domains) so a fresh deploy is safe-by-default.
- Add a `predeploy` config-sanity check (assert mainnet ⇒ live beacon, real domains, treasury ≥ floor).
- Add minimal CI (`.github/workflows`): lint + typecheck + test + the config-sanity assert on push.

---

## Phased plan to a clean launch

**P0 — gate the public announcement** (mix of owner + code):

1. [owner] Deploy Cloudflare geo-block on all 4 records; exempt `/proof/*`; test `CF-IPCountry: TH` (B-1).
2. [owner] Seed treasury ≥ 200 ALGO (B-2).
3. [owner] Separate admin key from keeper hot key; move admin to cold/multisig (H-6).
4. [code] Config landmine cluster (B-3a–e) + `predeploy` sanity check.
5. [code] Proof-card truth: capture `vrfOutput` (H-1) + relabel side (H-5).

**P1 — first hardening pass** (code, days 1-3 post-launch or pre-launch if time): 6. Keeper resilience: atomic DB writes + chain-reconcile (H-3), beacon-expiry escalation (H-4), auto-pause + treasury alert (H-7, H-8). 7. `recordBet` failure UX + local-recovery (H-2). 8. Idempotent `POST /bets` + atomic insert + missing indexes (M-2..M-6). 9. Monitoring: keeper heartbeat, `/status`, `/metrics` auth, Postgres backup (H-7, M-10, M-11, M-16).

**P2 — retention & polish** (code, week 1+): 10. ★ Live bet feed (mechanics-1). 11. Referral reanimation + earnings widget (mechanics-3). 12. Server-authoritative streak (mechanics-5), loss re-entry (mechanics-6), queue/share race (M-13), mobile tap targets (M-15). 13. Jackpot counter once treasury seeded (mechanics-4). 14. Low-severity batch + CI + screen-reader announce.

**Strategic:** set the Algo Minefield kickoff trigger before the public push.
