# Changelog

All notable changes to Fairground are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/).

Versioning model (see `packages/types/src/version.ts`): `PLATFORM_VERSION` is one semver for
the whole off-chain bundle (api + keeper + game + landing + shared packages), which deploys as
a unit. Contracts version independently by app id (a redeploy = a new app id + a version bump),
tracked in the `CONTRACTS` registry. MAJOR = contract redeploy / breaking ABI / incompatible DB
migration; MINOR = backward-compatible feature; PATCH = bug fix. `v1.0.0` = public launch.

## [0.9.0] — 2026-06-04

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
