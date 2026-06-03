# Fairground Testing Strategy

Goal: before every pre-launch iteration we can run one command set and **know** the whole
stack works — contract math, services, UI states, and the full on-chain flow — without a human
tapping a wallet.

The hard constraint: **automation cannot sign Pera/Defly transactions** (those need a device).
We solve it at Tier 4 with use-wallet's Mnemonic wallet, which signs programmatically.

## The four tiers

| Tier            | Covers                                                                | Tooling                                     | Signs txns?      | Speed |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------- | ---------------- | ----- |
| 1. Contract     | on-chain logic: payout 1.94x, referral, refund, idempotency, solvency | `algorand-python-testing` (pytest)          | deterministic VM | fast  |
| 2. Package      | service logic: keeper payout calc, proof-card shaping, api handlers   | Vitest                                      | mocked           | fast  |
| 3. Frontend e2e | every UI state, timing, copy, proof modal, **hydration/#418 guard**   | Playwright + `?demo=win\|loss`              | none needed      | fast  |
| 4. On-chain e2e | the whole stack: commit → VRF → keeper → payout → card                | Playwright + **Mnemonic wallet** on TestNet | **programmatic** | slow  |

A bug only one tier would catch is a bug. Example: the keeper once computed the payout with the
old `9800n` factor (1.96x) while the chain paid `9700n` (1.94x) — the card showed the wrong
number. Tier 2 (`packages/keeper/src/payout.test.ts`) now guards exactly that.

## Tier 1 — contract (pytest)

```bash
cd packages/contracts && python -m pytest tests/ -v
```

Deterministic. No LocalNet needed for the unit suite. Run before any contract change.

## Tier 2 — packages (Vitest)

```bash
pnpm turbo test            # all packages
pnpm --filter @fairground/keeper test
```

Key suites: `@fairground/nfd` (resolver + 3-state `lookupNfd`), `@fairground/keeper`
(`computeNetPayout` mirrors the contract edge).

## Tier 3 — frontend e2e (Playwright, no chain)

Drives the game through `?demo=win|loss` (the wallet-free walkthrough that runs the real UI
flow with a forced outcome) and the landing, asserting UI + copy + that **no React hydration
error (#418) fires**. No wallet, no chain, deterministic.

```bash
pnpm exec playwright install chromium        # one-time
pnpm test:e2e                                # defaults to the production URLs
GAME_URL=http://localhost:3000 LANDING_URL=http://localhost:4321 pnpm test:e2e   # local
```

Specs: `e2e/game.spec.ts`, `e2e/landing.spec.ts`.

## Tier 4 — on-chain e2e (programmatic signing)

`e2e/onchain.spec.ts`. The game built with `NEXT_PUBLIC_E2E=1` enables use-wallet's **Mnemonic
wallet** (`apps/game/app/providers.tsx`), which signs from a phrase instead of a device. The
spec connects it, answers the mnemonic `window.prompt` from `E2E_MNEMONIC`, and runs a real flip
to resolution.

Run on **TestNet** (free ALGO from the dispenser) — never on the production mainnet build, which
never enables the Mnemonic wallet (it also refuses mainnet by design).

Setup (one-time): deploy the contracts to TestNet, point an e2e build/keeper at them, fund a
TestNet account, then:

```bash
E2E_ONCHAIN=1 GAME_URL=<e2e-build-url> E2E_MNEMONIC="word word ... word" pnpm test:e2e
```

Skipped by default so the everyday suite stays fast and infra-free.

## Pre-launch loop

1. `pnpm turbo typecheck lint test` + `pytest` — Tiers 1-2 green.
2. Deploy to the e2e/TestNet stack.
3. `pnpm test:e2e` (Tier 3) and, when wired, `E2E_ONCHAIN=1 … pnpm test:e2e` (Tier 4).
4. Deploy to production; smoke `Tier 3` against the prod URLs.

## Backlog

- Wire a standing TestNet deployment + keeper so Tier 4 runs in CI on every release.
- Add Vitest coverage for the api leaderboard/proof routes with a mocked `db`/`redis`.
- A Playwright `webServer` block to auto-start local builds for Tier 3 in CI.
