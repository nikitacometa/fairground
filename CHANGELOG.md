# Changelog

All notable changes to Fairground are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/).

Versioning model (see `packages/types/src/version.ts`): `PLATFORM_VERSION` is one semver for
the whole off-chain bundle (api + keeper + game + landing + shared packages), which deploys as
a unit. Contracts version independently by app id (a redeploy = a new app id + a version bump),
tracked in the `CONTRACTS` registry. MAJOR = contract redeploy / breaking ABI / incompatible DB
migration; MINOR = backward-compatible feature; PATCH = bug fix. `v1.0.0` = public launch.

## [0.11.0] — 2026-06-04

Jackpot counter. The growing pot is now live — a retention hook that builds with every flip.

### Added

- **Jackpot ticker** on the game (`JackpotTicker`) — a subtle, always-present line showing the pot.
- The landing's "Jackpot Pool" stat is now wired (it was hardcoded to 0).

### Changed

- `GET /stats/live` computes `jackpotMicroalgo` as 1% of resolved volume (the slice of the 3% house
  edge earmarked for the pot) instead of a hardcoded `0`. Off-chain v1: a display accumulator with
  no row to seed/race; the draw/payout mechanism is a later version.

Referral reanimation. The 1% on-chain referral was inert — invisible to referrers and mislabelled.
Now it's a visible, trackable loop.

### Added

- **Refer-&-earn panel** on the game (`ReferralPanel`): a connected player's own referral link
  (copyable) plus their cumulative on-chain earnings and referred-flip count.
- `GET /referrals/:address` — referral earnings for a wallet, summed over every resolved flip that
  named it as the on-chain referrer (1% of each stake).

### Fixed

- Referral copy said the referrer earns "0.5% of the rake" — the contract pays **1% of the stake**.
  Corrected in the game and the comments.

Bet-lifecycle UX (audit H-2 + the M2 follow-up). A confirmed flip never lies about the player's funds,
and never silently strands itself.

### Fixed

- **False "your funds were not wagered" on a tracking failure.** If the flip confirmed on-chain but
  the follow-up `recordBet` call failed, the UI told the player their funds were safe — a lie (the
  stake is escrowed). The error now distinguishes a pre-commit failure (sign rejected / bet out of
  range — truly not wagered) from a post-commit failure (flip is on-chain; only the tracker call
  failed) and shows truthful copy with refund guidance.
- **A flip whose registration was lost would never resolve.** Without a session row the keeper never
  picks the flip up. The client now persists a per-wallet recovery record on confirmation and, on
  reload/reconnect, re-registers the flip (recordBet is now idempotent) and resumes polling.
- **Infinite polling on a terminal session.** The UI polled forever when a session ended `failed` or
  `beacon_expired` (bet outcome stays `pending`). It now stops on those states and shows refund
  guidance. `fetchBetState` surfaces `session.state` for this.

### Changed

- `POST /games/:gameId/bets` is idempotent (returns the existing session for a duplicate flip txn id)
  and inserts the bet + session in one transaction (no orphan bet on a partial failure).

Keeper resilience (audit H-3 + H-4). The keeper no longer strands a bet on a crash or a stale beacon.

### Fixed

- **Crash window between on-chain resolve and DB write.** resolve() moves money and deletes the
  flip box, then the keeper recorded the outcome in two separate updates — a crash in between left
  the bet stuck `pending` forever (the stale sweep re-queued it, the retry reverted with "no active
  flip", and it died at `failed`). The session + bet writes are now a single `db.transaction`, and a
  revert is reconciled from the chain: the keeper finds the already-submitted resolve txn via the
  indexer, re-derives the outcome from the on-chain VRF output, and records it (`reconcile.ts`).
- **Beacon-expiry retry storm.** A flip whose VRF round aged past the beacon's ~70-min retention can
  never resolve (`must_get()` panics). The keeper now detects this before sending a doomed txn and
  marks the session `beacon_expired` (new state) instead of looping into `failed` with no signal —
  the player reclaims funds via the 48h refund path.

### Changed

- Corrected the resolve() fee comment (the inner-txn worst case is 6, not 4; the 8000-microALGO
  pool already covers it).

Proof-card truth (audit H-1 + H-5). The card is the marketing artifact; it now tells the truth.

### Fixed

- **VRF beacon hash was always 64 zeros.** The keeper never captured the beacon output, so
  every proof card rendered `00…00` for the "Beacon Output Hash" — undermining the
  verifiable-by-anyone claim. The keeper now extracts the 32-byte VRF output from the
  resolve() inner `must_get()` return log (`vrf-extract.ts`) and writes `bets.vrfOutput`,
  with a provably-fair self-check (sha256(beacon ‖ salt) must reproduce the on-chain outcome).
  All 7 historical resolved bets were backfilled from the indexer.
- **Proof card showed the wrong coin side.** Win always rendered "HEADS · WON", loss always
  "TAILS · LOST", regardless of the player's actual call. The player's pick is now recorded
  (`bets.player_pick`, migration 0001) and the card shows the real side ("TAILS · WON"); pre-M1
  bets with no recorded pick show a plain WON/LOST instead of asserting a side.

### Added

- `playerPick` threaded end-to-end: game → `POST /games/:gameId/bets` → DB → proof card.
- Referral wallet is now recorded with the bet (the frontend previously dropped it).

First versioned release. Establishes the versioning scheme and closes the config-drift
landmine cluster found in the 2026-06-04 pre-launch audit (`docs/audit/launch-audit-2026-06-04.md`).

### Added

- Versioning foundation: `PLATFORM_VERSION` + `CONTRACTS` registry + `checkMainnetConfig()` in
  `@fairground/types`; `GET /status` surfacing version, network, git sha, and the contract
  registry; platform version in the game and landing footers.
- Loud startup config-drift check in the API and keeper — a mainnet process pointed at the dead
  beacon, a stale app id, or the wrong CORS domain now logs a `CONFIG DRIFT` error.

### Fixed

- Default `VRF_BEACON_APP_ID` was the dead 2022 beacon (`947957720`); now the live
  `1615566206`. A fresh deploy that omits the env var is safe by default.
- Default `CORS_ORIGINS` pointed at `fairground.xyz`; now `fairground.quest`.
- `runMigrations()` was dead code (never called) — wired into keeper startup so a fresh
  database gets its schema before the poll loop runs.
- `.env.example` corrected (beacon, CORS, API URL, Plausible domain → `fairground.quest`).
- `ops/safety-state.md` rewritten from stale testnet/not-deployed placeholders to the verified
  live mainnet state; corrected `max_payout_bps` to the on-chain value (1000 = 10%, not 1%).

### Security

- `.gitignore` now excludes `runtime.config` (holds the keeper mnemonic and live app ids).

### Contracts (unchanged)

- `coinflip` v1 — app `3585680948` (3% house edge → 1.94x, 1% referral).
- `houseTreasury` v1 — app `3584287403`.
