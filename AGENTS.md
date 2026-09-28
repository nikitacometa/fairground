# Fairground — instructions for AI agents

> Source of truth for every agent (Claude Code, Codex, Cursor). `CLAUDE.md` imports this file.
> Personal repo. Money-path: on-chain treasury + VRF payouts. Numbers in this file were verified
> against code on 2026-09-28 (commands below each claim) — re-verify before trusting an older copy,
> including copies inside this repo (see "Stale facts" below).

## What this is

Provably-fair on-chain degen games on Algorand. TypeScript monorepo (pnpm + Turborepo) + Python/Puya
smart contracts. CoinFlip is live on mainnet; a v2 with a daily jackpot pot was deployed and then
reverted (`git log --oneline`: `f419e0d` deploy → `8f85e83` revert). **Do not assume the current game
set or bet economy from this file — check `BOARD.md` and `git log` first**, they change faster than
instructions do.

Brand is deliberately separate from Cometa (regulatory distance for Cometa's FaaS business). Sharing
`~/dev/cometa/` is local-dev convenience only (shared Algorand tooling context) — separate repo,
domain, on-chain entity, brand. The folder path is not a compliance boundary.

Stack, versions and rationale: `docs/architecture.md` (this file no longer carries its own copy — the
two had already diverged). Product rationale (historical, pre-launch): `docs/research/*.md`. Current
specs: `docs/game-specs/*.md`, `docs/tokenomics.md`, `docs/roadmap.md`, `docs/compliance.md`,
`docs/testing.md`.

## Commands

```bash
pnpm install
pnpm turbo build
pnpm turbo test                          # Vitest, all packages
pnpm turbo lint && pnpm turbo typecheck
(cd packages/contracts && algokit localnet start)
(cd packages/contracts && algokit compile python smart_contracts/coinflip/contract.py --out-dir artifacts && \
  algokit compile python smart_contracts/house_treasury/contract.py --out-dir artifacts && \
  algokit compile python smart_contracts/leaderboard/contract.py --out-dir artifacts && \
  algokit compile python smart_contracts/fairjackpot/contract.py --out-dir artifacts)  # after any contract change; without --out-dir puyapy 5.8.1 writes beside contract.py, not into artifacts/
make contracts-generate                  # after any ABI change — from repo root; one `algokit generate
                                          # client --language typescript` call per contract, see Makefile
(cd packages/contracts && python -m pytest tests/ -v)    # deterministic, no LocalNet needed
pnpm test:e2e                            # Playwright; defaults to production URLs — set GAME_URL/LANDING_URL for local
```

Keep the parens: each subshell keeps its `cd` from leaking into the next command. The compile paths
are relative to `packages/contracts/` (`packages/contracts/README.md`) and resolve wrong if you drop
the subshell and just `cd` once for the whole block. **`pnpm contracts:build|test|generate` and
`make contracts-build|contracts-test` all shell out to `algokit project run build|test|generate` —
`packages/contracts/.algokit.toml` defines no `[project.run.*]` task, so none of those five commands
work.** Use the direct commands above instead. `make contracts-generate` is the one wrapper that does
work: it bypasses `algokit project run` entirely and calls `algokit generate client --language
typescript --output <file>` once per contract (see Makefile) — there's no single "regenerate
everything" command. Four testing tiers (contract pytest → package Vitest → frontend e2e → on-chain
TestNet e2e with a Mnemonic wallet), commands and the one documented regression (a keeper/contract
payout-factor mismatch): `docs/testing.md`. Kill-the-mutant convention: `packages/contracts/README.md`
(not `docs/testing.md`).

## Critical invariants (verified against code, commands shown)

- **bigint everywhere.** Every microALGO/ASA amount, Algorand app ID and round number is `bigint` in
  TypeScript; never `Number()`. API responses serialize bigint as `string` via a JSON replacer.
- **Generated code is never hand-edited.** `packages/sdk/src/clients/**` comes from
  `algokit-client-generator`; regenerate after any contract ABI change, don't patch the output.
  **ARC-56/ARC-32 compatibility is resolved, not open**: `algokit-client-generator@6.0.1` fully accepts
  ARC-56 input from `puyapy 5.8.1` (its npm description says "ARC-0032"; that's a stale description,
  not a support claim). No `--output-arc32` fallback is needed — all four clients in
  `packages/sdk/src/clients/` were generated this way (`ls packages/sdk/src/clients/` to re-verify).
  `docs/architecture.md` and `packages/contracts/README.md` still called this unresolved as of the
  same 2026-09-28 pass that wrote this file; corrected in the same commit.
- **No raw algosdk group construction** in `apps/game` or `packages/api` — go through the typed
  `@fairground/sdk` clients.
- **`simulate()` before `send()`** on any non-trivial on-chain operation.
- **The VRF beacon app ID is not a constant to memorize or copy into a doc.** The mainnet beacon has
  already changed once: `947957720` (2022 deployment) is explicitly dead —
  `grep -rn 947957720 packages/sdk/src/vrf/beacon.ts packages/types/src/version.ts packages/contracts/smart_contracts/deploy_config.py`
  turns up three independent comments calling it "DEAD". The live ID lives in
  `packages/types/src/version.ts` / the deployed `.env` (`VRF_BEACON_APP_ID`), not in this file —
  read it there every time, because the same drift will happen again. **TestNet is separately
  disputed**: `beacon.ts`'s own comment calls TestNet ID `110096026` "UNVERIFIED", `BOARD.md` FG-011
  calls it "on-chain verified" — before configuring a network or writing on-chain integration tests,
  verify that network's beacon against an indexer yourself; the mainnet registry is not TestNet
  evidence.
- **Commit-reveal timing** (`packages/contracts/smart_contracts/coinflip/contract.py`): `flip()`
  commits to `ceil8(current_round + BEACON_DELAY)` where `BEACON_DELAY = 8` (so the committed round is
  8–15 rounds out); `resolve()` requires `current_round >= commit_round + BEACON_SETTLE_BUFFER`
  (`BEACON_SETTLE_BUFFER = 4`) before reading the beacon. Never reduce either constant. A premature
  `must_get()` reverts (no state change, keeper retries — see `packages/keeper/src/resolver.ts`), it
  does not strand the session; the real permanent-loss risk is the beacon's ~70-minute output
  retention window closing before `resolve()` is ever called.
- **48h player-triggered refund is mandatory in every game contract** (`REFUND_WINDOW_ROUNDS = 61_714`
  rounds ≈ 48h at 2.8s/round, same file). Keeper failure must never lock player funds. `refund()` pays
  bet + box MBR directly from the game contract's own balance and never touches `house_treasury` — it
  must keep working even when the treasury is paused or the keeper is down. When constructing the
  `flip()` group, fund the exact box MBR on top of the bet; a resolve/refund group must pool enough
  fee for every inner transaction it triggers. `resolve()` is permissionless by design — anyone can
  call it, not only the keeper.
- **Treasury-first, solvency-checked-late.** `house_treasury` is deployed before any game contract;
  `resolve()` calls `HouseTreasury.pay_winner()` (not `get_available_balance()`), which enforces
  `payout <= (balance - min_balance) * max_payout_bps // 10000` — spendable balance, not gross —
  **at settlement time**, not at bet time. `get_available_balance()` is a separate, advisory pre-bet
  read; it is not the settlement guard.
- **Box deletion order is asymmetric — don't generalize "delete after every transfer" as a universal
  rule.** In `resolve()`: submit every inner transfer (referral, jackpot, treasury sweep, payout)
  first, delete the box, _then_ return its MBR last (returning MBR before deletion can fail — that
  balance isn't spendable while the box exists). In `refund()`: delete the box _before_ its one
  combined `bet + BOX_MBR` payment. Either way, box deletion (no `claimed` field) is what makes a
  resolve/refund against an already-settled session revert instead of silently double-paying — check
  the actual sequence in `contract.py` before changing it.
- **Keeper leader election**: Redis `SETNX` lock (`packages/keeper/src/lock.ts`), 10s TTL, refreshed
  every 4s, released on graceful shutdown. Renewal and release are both owner-checked and atomic
  (Lua `GET`+`PEXPIRE`/`DEL` — prevents a TOCTOU race where an instance extends or deletes a lock it
  no longer holds). `packages/keeper/src/index.ts` also serializes ticks (`tickRunning` guard) because
  a resolve batch can run longer than the poll interval — without it, an overlapping tick could pick
  up a still-`pending` session and resolve it twice (second call reverts on-chain but still churns
  the DB and burns algod calls). Preserve both the atomic lease and the serial-tick guard; don't run
  resolve logic outside the lock holder, and don't remove the overlap guard to "speed up" polling.
- **Keeper accounting must match deployed contract behavior, not source defaults.** UI results, proof
  cards and keeper-recorded payouts must reflect the actual deployed contract version's economics —
  `packages/keeper/src/payout.ts` documents a real incident where it used a stale payout factor
  (9800n / 1.96x) while the chain actually paid 9700n / 1.94x (`docs/testing.md`'s Tier-2 example).
  Check `payout.ts` and its tests, and the deployment registry, before changing keeper accounting, UI
  results or proof-card math — don't assume current contract-source defaults match what's deployed.
- **Numbers that move at deploy/env time — read them from source, not from a doc or this file**: box
  MBR, house edge bps, referral bps, min/max bet, treasury auto-pause floor, `max_payout_bps`. Sources:
  `packages/contracts/smart_contracts/{coinflip,house_treasury,leaderboard}/contract.py` (box MBR is a
  `typing.Final` per contract), `packages/contracts/smart_contracts/deploy_config.py` (house edge /
  referral bps env-overridable defaults), the live `.env` (bet limits, treasury floor). See "Stale
  facts" below for concrete proof these numbers already disagree across the repo.
- Secrets never enter the repo. `HOUSE_SEED_WALLET_MNEMONIC` / any 25-word phrase must never be
  staged — **there is currently no enforcing hook** (`BOARD.md` FG-008 is still `todo`, `.husky/`
  only runs lint-staged). Grep before committing anything near env or deploy scripts.

## Stale facts found in this repo (flagged, not fixed — out of scope for this instruction-layer pass)

Verified 2026-09-28. None of these are edited by this change; they are called out so no agent (or
owner) treats them as current by accident.

- **Dead VRF beacon ID baked into docs and a skill.** `docs/tokenomics.md`, `docs/game-specs/coinflip.md`,
  and the `fairground-contract` skill's `reference/vrf-integration.md` / `reference/house-pool-math.md`
  all still hardcode mainnet beacon `947957720`. Current code calls that ID dead in three places (see
  invariant above). `SKILLS.md`'s workflow description for `fairground-contract` also quotes it.
- **House economics disagree across sources, not just against `deploy_config.py`.** `docs/tokenomics.md`
  says "2% house edge / 0.5% referral"; the `fairground-contract` skill's `reference/house-pool-math.md`
  computes referral at 25 bps (0.25%), not 0.5% — those two already disagree with each other.
  `deploy_config.py` defaults are `HOUSE_EDGE_BPS=500` (5%) / `REFERRAL_BPS=100` (1%) / `JACKPOT_BPS=150`
  (1.5%) (`grep -n HOUSE_EDGE_BPS\|REFERRAL_BPS\|JACKPOT_BPS packages/contracts/smart_contracts/deploy_config.py`).
  Only the deployed contract's live global state is authoritative for any of these — the docs are
  historical/aspirational and don't even agree among themselves.
- **`.env.example`'s bet-limit default is a schema default, not evidence of drift** — `MIN_BET_MICROALGO=
MAX_BET_MICROALGO=500000` (0.5 ALGO) is explicitly a scaffold/schema default, not a snapshot of
  production config. `docker-compose.yml`'s build args (`NEXT_PUBLIC_MIN_BET_MICROALGO=1000000`,
  `NEXT_PUBLIC_MAX_BET_MICROALGO=20000000`) agree with the mainnet `raise minimum bet to 1 ALGO` and
  `update landing ticker to 1-20 ALGO bet economy` commits — production bet limits are corroborated,
  not contradicted, by two independent sources. What's still unverified is whether the _deployed
  contract's_ on-chain `min_bet`/`max_bet` global state actually matches 1–20 ALGO; check that
  directly before quoting a number as currently enforced on-chain.
- **Production domain is configured as `fairground.quest`**, not `fairground.xyz` (not independently
  re-verified live here — this is repository-config evidence):
  `grep -n server_name ops/nginx/fairground.quest.conf`, `docker-compose.yml`'s build args
  (`https://api.fairground.quest`), and `.env.example`'s `CORS_ORIGINS`/`PLAUSIBLE_DOMAIN` all agree
  on `.quest`. `docs/architecture.md`, `docs/compliance.md`, `docs/tokenomics.md`'s referral URL, and
  `apps/landing/astro.config.mjs`'s `site:` field still say `.xyz`. `docker-compose.yml` line 11's own
  comment is stale too (routes `api.fairground.xyz`).
- **Geo-blocking status is unverified live.** The untracked `docs/audit/launch-readiness-2026-06-09.md`
  (agent-authored, not part of this rework) reported `CF-IPCountry` never reaching the app —
  geo-block fully bypassed — as of that date. Not reverified here. Compliance treats geo-block as
  non-negotiable (`docs/compliance.md`); confirm current status before relying on it.

## Testing

Four tiers — contract pytest, package Vitest, Playwright frontend e2e (`?demo=win|loss`, no wallet),
Playwright on-chain e2e (TestNet, programmatic Mnemonic wallet, opt-in via `E2E_ONCHAIN=1`). Full
detail, commands and the one documented regression: `docs/testing.md`. Contract tests: kill-the-mutant
required (`packages/contracts/README.md` → Kill-the-Mutant Verification) — comment out the checked
line in the SUT and confirm a specific test goes red before committing; name the test after the
mutation it kills.

## Commits and delivery

- Lowercase verb, no type prefix (`add coinflip contract v1`, not `feat: ...`), no internal jargon in
  the message (no `FG-NNN`, no "Phase N"), no AI attribution. Update `BOARD.md` task status in the
  same commit as the code that closes it. Never `--no-verify` (Husky runs `eslint --fix && prettier
--write` on staged `*.ts`/`*.tsx`).
- **Commit authorization does not imply push authorization** — push only within the
  task-authorized scope (see "For Codex and other agents" below); don't push automatically just
  because a commit landed.
- No review skill/gate and no docs-drift check are installed in this repo (personal repo — installing
  them is out of scope for this change). Self-review money-path diffs before pushing; nothing else
  will catch them before CI does.

## Compliance (short version — full policy `docs/compliance.md`)

This is house-banked gambling; treating it as anything else operationally is a legal risk. Geo-block
of TH/US/UK/ID/IN/BR is non-negotiable — the operator is in Bangkok, direct personal exposure under
Thai law. Foundation-facing and xGov copy frames the product as VRF/provably-fair infrastructure, never
"casino"/"gambling"/"wager". See "Stale facts" above for the current domain and geo-block-verification
caveats before writing anything public-facing.

Scope gates (not superseded by the reverted jackpot experiment — that reverted one implementation,
not the underlying restrictions): before proposing or implementing additional games, tokens, ASA
support or native mobile apps, read the current gates in `docs/roadmap.md` and `docs/tokenomics.md`.
Before public launch messaging or Foundation/ecosystem amplification, verify geo-blocking and the
treasury/TOS/open-source/proof-endpoint prerequisites in `docs/compliance.md` — don't treat "the code
exists" as "cleared to announce."

## For Codex and other agents

- This file is the source of truth; Claude Code loads it through `CLAUDE.md`, Codex reads it natively.
  An untracked `AGENTS.override.md` currently shadows this file for Codex — its useful content (task
  routing, money-path summary) is folded in above; delete the override once this file replaces the
  tracked `AGENTS.md`, otherwise Codex keeps reading the stale override instead of this file. The
  parent `~/dev/cometa/AGENTS.md` also exists and applies to this repo (shared workspace boundaries);
  Codex loads it automatically by directory hierarchy, Claude/Cursor should read it once per session.
- Task routing: architecture/economics → `docs/architecture.md`, `docs/game-specs/`, `docs/tokenomics.md`
  (treat its numbers as historical/aspirational, verify against contract state or `deploy_config.py`
  before quoting one); test lanes → `docs/testing.md`; release/ops → `docs/runbooks/`, `ops/`, current
  deployment config; product/design exploration → the specific `docs/design/` or `docs/research/` file
  for the feature at hand, not the whole library for a narrow fix.
- Contract source `packages/contracts/` (Python/AlgoKit workspace, **not** a pnpm package); SDK
  `packages/sdk/`; API `packages/api/` (Hono); keeper `packages/keeper/`; game `apps/game/` (Next.js
  App Router); landing `apps/landing/` (Astro).
- No standing authorization to commit/push/deploy/sign/broadcast or publish content. Execute only the
  task-authorized scope; verify the resulting artifact/health afterward rather than trusting a green
  build.
- Node ≥22, pnpm ≥11.5.0 (`package.json` `engines`/`packageManager`) — read installed version pins from
  `package.json`/lockfiles, not this file or any dated instruction table.

## Repository map

| Path                          | Purpose                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/`         | Python/AlgoKit workspace (not pnpm): `smart_contracts/{house_treasury,coinflip,leaderboard,fairjackpot}/`, `deploy_config.py`, per-contract `smart_contracts/<contract>/artifacts/*.arc56.json` (generated, never hand-edit — there is no top-level `packages/contracts/artifacts/`), `tests/` |
| `packages/sdk/`               | `@fairground/sdk` — generated ARC-56 TS clients (`src/clients/`, never hand-edit) + VRF helpers (`src/vrf/beacon.ts`)                                                                                                                                                                          |
| `packages/types/`             | `@fairground/types` — Zod schemas, env validation, beacon/version guard (`src/version.ts`)                                                                                                                                                                                                     |
| `packages/db/`                | `@fairground/db` — Drizzle schema + pg client                                                                                                                                                                                                                                                  |
| `packages/api/`               | `@fairground/api` — Hono REST + WS                                                                                                                                                                                                                                                             |
| `packages/keeper/`            | `@fairground/keeper` — VRF resolver, Redis SETNX leader lock (`src/lock.ts`)                                                                                                                                                                                                                   |
| `packages/proof-card/`        | `@fairground/proof-card` — satori/resvg PNG generator                                                                                                                                                                                                                                          |
| `apps/game/`, `apps/landing/` | Next.js game dApp; Astro landing                                                                                                                                                                                                                                                               |
| `docs/`                       | canonical docs: `architecture.md`, `testing.md`, `compliance.md`, `tokenomics.md`, `roadmap.md`, `game-specs/*`, `design/*`, `runbooks/*`, `research/*` (historical), `audit/*` (point-in-time, not live status)                                                                               |
| `ops/`                        | `geo-blocking.md`, `safety-state.md`, `weekly-plan.md`, `nginx/*.conf`                                                                                                                                                                                                                         |
| `.claude/skills/`             | `fairground-contract`, `fairground-frontend`, `fairground-landing`, `puya-gotchas`, `smart-contract-audit` (index: `SKILLS.md`); two `fairground-contract` reference files are stale, see above                                                                                                |

## Gotchas

- Sibling repos worth reusing from: `cometa-strategy` (design-bible origin, `research/algorand-degen-games-2026-05.md`),
  `prediction-market` (Puya box-storage/AlgoKit workspace patterns), `metafarm-frontend`
  (`walletConnectService.ts` iOS relayer-wake hook, not yet ported into `useRelayerWake()`).

(The `BOARD.md` FG-008 secret-scan gap and `.env.example`'s stale schema defaults are covered once
each, in Critical invariants and Stale facts above — not repeated here.)
