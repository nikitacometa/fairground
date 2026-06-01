# Fairground — Scaffold Meta-Audit & Build Plan

**Date:** 2026-06-01 · **Scope:** the whole monorepo as scaffolded (6 commits, never installed before today) · **Method:** direct toolchain runs (install / compile / typecheck / build) + a 13-agent fan-out audit (internals, setup, web research, neighbor mining) + manual review of the contracts and load-bearing TS.

---

## Executive summary

The skeleton is **good**; the body **does not run yet**. Architecture, version pins, and design decisions are sound, but the scaffold ships with bugs that are _wrong_, not merely _incomplete_: the contracts do not compile, the SDK does not type-check, and several production-blocking config defects (Docker network, API server, MCP package name) would break the system the moment it deployed.

**Scaffold quality: ~5/10** against the bar "production-ready for a contract that holds real ALGO and auto-pays." Excellent for "a place to start from"; not yet "trustworthy enough to follow without reading the code."

| What                                | State                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency version pins             | **All valid & current** — every npm/PyPI pin resolves to the latest release as of 2026-06-01. Zero hallucinated packages (one MCP package _name_ is wrong — see C4). |
| `pnpm install`                      | **Works** (680 packages) — after toolchain fixes (node 22, pnpm 11.5, `onlyBuiltDependencies`).                                                                      |
| Contract compile (`puyapy 5.8.1`)   | **FAILS** — 3 classes of algopy errors across all 3 contracts. No artifacts produced.                                                                                |
| `tsc` typecheck                     | **FAILS** at `@fairground/sdk` — wrong algokit-utils import, algosdk v3 API drift, missing `@types/node`, deprecated `baseUrl`.                                      |
| `tsup` build                        | esbuild/ESM/CJS **OK**; `.d.ts` emit fails (same `baseUrl` + TS errors).                                                                                             |
| Tests                               | **0 executable** — all 61 contract test functions are `pytest.skip()` stubs; TS packages have no tests; `vitest.workspace.ts` points at 8 non-existent configs.      |
| Public brand / landing / compliance | Not shipped (expected at this phase). Geo-block is non-functional as wired (see C2/C3).                                                                              |

**The five things to fix before anything else** (details below): C1 contracts don't compile · C2 Docker `internal: true` cuts the backend off the internet · C3 API server drops all request headers (geo-block + CORS dead) · C5 treasury drains with no replenishment path · C6 refund backdoor breaks when treasury is paused (violates "never lock player funds").

---

## 1. Toolchain reality — what actually runs on this machine

The project's pinned stack is real, but the local environment needs three corrections before a green build is possible. All were discovered by running the commands, not by reading docs.

| Step                     | Result     | Root cause / fix                                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`           | ❌ then ✅ | Installed pnpm is **9.7.1**; root requires `>=11.5.0` with `engine-strict=true`. pnpm 11.5 **crashes on node 23.3.0** (`node:sqlite` is unflagged only in node ≥22.13 / ≥23.4). **Fix: use node 22 LTS** (matches `.nvmrc`); pnpm 11.5 then runs.                                                   |
| build-script gate        | ❌         | pnpm 11 blocks `esbuild`/`sharp` postinstall (`ERR_PNPM_IGNORED_BUILDS`) → `install` exits 1 → every `pnpm run`/turbo task fails the `verify-deps-before-run` gate. **Fixed:** added `onlyBuiltDependencies: [esbuild, sharp]` to `pnpm-workspace.yaml` (pnpm 11 moved this out of `package.json`). |
| `algokit localnet start` | ❌         | Docker **compose v2.3.3** < required **v2.5.0**. LocalNet cannot start → contract integration tests cannot run locally. **Fix: upgrade Docker Desktop / compose plugin.**                                                                                                                           |
| `algokit compile python` | ❌         | Needs **pipx** (not installed). Installed it; compile then ran and surfaced the real errors (§2).                                                                                                                                                                                                   |
| corepack pin             | ❌         | corepack bundled with node 23.3.0 has stale signing keys (`Cannot find matching keyid`). Use `nvm`/`pnpm` directly, not corepack, or `COREPACK_INTEGRITY_KEYS=0`.                                                                                                                                   |

### Green-build recipe (run once)

```bash
nvm use 22                      # node 22.x — has node:sqlite, satisfies engines
corepack disable 2>/dev/null || true
npm i -g pnpm@11.5.0            # or: COREPACK_INTEGRITY_KEYS=0 corepack prepare pnpm@11.5.0 --activate
pnpm install                    # onlyBuiltDependencies now lets esbuild/sharp build
pnpm exec turbo run typecheck   # will surface §3 TS errors until they're fixed
# contracts:
python3 -m pip install --user pipx
algokit compile -v 5.8.1 py packages/contracts/smart_contracts/...   # fails until §2 fixed
# upgrade Docker compose to ≥2.5.0 before `algokit localnet start`
```

---

## 2. Contracts — do not compile (P0, blocks everything downstream)

`algokit compile -v 5.8.1 py …` over all three contracts produced **errors, no artifacts**. Three error classes, all mechanical but all blocking. Until these are fixed there are no ARC-56 artifacts, therefore no generated TS clients, therefore the keeper resolver and the game client stay as TODO stubs.

| #   | Error (puyapy 5.8.1)                                                                                                          | Locations                                                                                                                                                                                    | Fix                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2a  | `Unable to resolve global constant reference` — module-level `X: UInt64 = UInt64(n)` constants are not compile-time constants | `house_treasury.py` (`DEFAULT_MAX_PAYOUT_BPS`, `REGISTERED_FLAG`), `coinflip.py` (`BOX_MBR`, `BEACON_SETTLE_BUFFER`, `REFUND_WINDOW_ROUNDS`, …), `leaderboard.py` (`REGISTERED_CALLER_FLAG`) | Declare as plain `Final` int literals: `BOX_MBR: typing.Final = 49_700` and wrap inline `UInt64(BOX_MBR)` at use sites. Affects **all three contracts**.                                                                                |
| 2b  | `_ is not currently supported as a variable name`                                                                             | `house_treasury.py:205`, `coinflip.py:392` (`_, exists = …maybe(...)`)                                                                                                                       | Use a named throwaway: `_unused, exists = …` is also rejected — assign to a real name (e.g. `flag, exists`) or index: `r = …maybe(...); exists = r[1]`.                                                                                 |
| 2c  | `tuples containing a mutable reference to an ARC-4-encoded value cannot be unpacked`                                          | `coinflip.py:385` (`state, exists = self.flips.maybe(player)`), `leaderboard.py:168` (`stats, exists = self.stats.maybe(player)`)                                                            | For struct-valued `BoxMap.maybe()`, use index access: `r = self.flips.maybe(player); state = r[0].copy(); exists = r[1]`. Note `flip():151` already does this correctly (`self.flips.maybe(player)[1]`) — the codebase is inconsistent. |

> The local `puya-gotchas` skill does **not** cover 2b or 2c — exactly the class of error a `.maybe()`-unpacking gotcha should catch. Add both patterns to the skill.

### Contract safety / architecture findings (fix before any on-chain bet)

| Sev | Finding                                                                                                                                                                                                                                                                                                                                                                                           | File                                                     | Fix                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | **Refund backdoor breaks when treasury is paused.** `refund()` calls `treasury.pay_winner()`, which asserts `paused == 0`. Emergency-pause the treasury and the 48h player refund reverts — funds locked in exactly the incident scenario the backdoor exists for. Violates the stated invariant "keeper failure must never lock player funds."                                                   | `coinflip.py:301-338`                                    | Pay the refund directly from the coinflip contract's own balance (the bet is already there): `del self.flips[player]; itxn.Payment(receiver=Txn.sender, amount=bet + BOX_MBR, fee=0).submit()`. Remove all treasury dependency from `refund()`. |
| P0  | **Treasury drains with no replenishment.** Bets are paid to the _coinflip_ contract (`flip():154`); winners and refunds are paid from the _treasury_. Nothing moves losing bets to the treasury. At ~100 flips/day the treasury bleeds ~49 ALGO/day while the 2% edge accumulates **unreachably** in the coinflip account (no withdraw method). Treasury hits the solvency floor and auto-pauses. | `coinflip.py`, `house_treasury.py`                       | Decide capital flow (Open Question #5): **(A)** route bets straight to treasury (cleanest for the shared-treasury design), or **(B)** add admin-only `sweep_to_treasury()` on coinflip. Pick A.                                                 |
| P0  | **All 61 contract tests are skipped.** Both test files' fixtures call `pytest.skip()` unconditionally → `pytest` exits green with **zero** assertions. Solvency, idempotency, refund-timing, and auth invariants have no test evidence. Kill-the-mutant is impossible.                                                                                                                            | `tests/test_coinflip.py`, `tests/test_house_treasury.py` | Implement with `algopy_testing_context()`. Minimum before mainnet: payout-above-ceiling-reverts, idempotent-resolve (box deleted), refund-after-48h, unregistered-caller-rejected.                                                              |
| P1  | **`emergency_withdraw()` is an instant rug.** Admin can drain the entire treasury after a single pause txn — no timelock, no multisig. For a 2,000–10,000 ALGO pool, admin-key compromise = total loss.                                                                                                                                                                                           | `house_treasury.py:208` (TODO present)                   | Add a `request_withdraw()` + `Global.round`-based 48h timelock, or renounce admin after seeding (immutable deploy).                                                                                                                             |
| P1  | **`register_game()` / `record_result()` don't enforce MBR payment** (TODO comments). Admin-only, so low risk now, but the box MBR is silently paid from the app's own balance.                                                                                                                                                                                                                    | `house_treasury.py:93`, `leaderboard.py:151`             | Add `pay: gtxn.PaymentTransaction` param + assert receiver/amount.                                                                                                                                                                              |
| P1  | **`BEACON_SETTLE_BUFFER = 2` is below the documented worst case.** The beacon writes proofs up to **3 rounds** after the ceil-8 target; `resolve()` can call `must_get()` before the proof exists → panic.                                                                                                                                                                                        | `coinflip.py:58`, `sdk/.../beacon.ts:35`                 | Set buffer to **4** in both. Costs ~2 extra blocks (~6s); eliminates a class of unresolvable sessions.                                                                                                                                          |
| P2  | **Dead `claimed` field.** `FlipState.claimed` is never set to `True`; box deletion is the real idempotency guard. Adds 1 byte to MBR and gives false confidence in `refund()`'s `not claimed` check.                                                                                                                                                                                              | `coinflip.py:76`                                         | Remove before the struct is frozen into ARC-56 artifacts.                                                                                                                                                                                       |
| P2  | **Undocumented box reference for `resolve()`.** The inner `pay_winner()` reads the treasury's `registered_games` box; the outer `resolve()` group must declare `boxes=[(treasury_app_id, b"game:" + coinflip_addr)]` or it fails at runtime. Not documented anywhere the keeper author would see it.                                                                                              | `coinflip.py:resolve`                                    | Add a docstring listing all required foreign resources.                                                                                                                                                                                         |

**What's correct in the contracts** (do not churn): VRF commit-reveal logic (N+8 commit, `must_get` ABI call, `sha256(beacon‖salt)[0] % 2`), `arc4.Address` BoxMap key encoding, `BoxMap.maybe()` return-order usage, box-deletion-last idempotency, emergency pause, `Global.zero_address` referrer guard, the in-contract MBR math (49,700 is correct).

---

## 3. TypeScript packages — won't build/run as-is

`turbo run typecheck` fails at `@fairground/sdk` (turbo stops there). Confirmed by `tsc`:

### `@fairground/sdk`

- `algorand-client.ts:8` — **`AlgoClientConfig` is not exported** by `@algorandfoundation/algokit-utils@9.2.0`. `algorand-client.ts:39` calls `AlgorandClient.fromClients({algod: config, …})` with config objects; `fromClients` expects live `algosdk.Algodv2` instances. **Fix:** use `AlgorandClient.fromConfig({ algodConfig, indexerConfig })` (or `fromEnvironment()`).
- `beacon.ts:71` & `keeper/resolver.ts:35,45` — **`status['last-round']` doesn't exist in algosdk v3**; the response is a typed model with **`lastRound`** (camelCase, already `bigint`). `tsc`: _"Did you mean 'lastRound'?"_ `BigInt(undefined)` would throw at runtime.
- `algorand-client.ts` + `beacon.ts` — **missing `@types/node`**: `process`, `node:crypto`, `Buffer` all unresolved. Add `@types/node` devDep and `"types": ["node"]` / `lib` to the package tsconfig.
- build: **`TS5101: 'baseUrl' is deprecated`** under typescript@6.0.3 breaks `.d.ts` emit. Remove `baseUrl` (use bare `paths`, supported since TS 5.0) or set `"ignoreDeprecations": "6.0"`. Affects every package that emits dts.

### `@fairground/api`

- `index.ts:11-17` — **the custom Node HTTP handler builds `new Request('http://localhost' + req.url)` with no method/headers/body.** Geo-block (`CF-IPCountry`) and CORS (`Origin`) see an empty header set → **geo-block never fires, CORS never emits**, and POST routes default to GET. The `serve` import from `@hono/node-server` is unused. **Fix:** use `@hono/node-server`'s `serve({ fetch: app.fetch, port }, info => attachWebSocket(info.server, …))`.
- `routes/leaderboard.ts:19` — **`eq()` used but not imported** (`:4` imports only `desc`) → ReferenceError. Add `eq`.
- `routes/ws.ts` — Redis subscriber has **no `error` handler** → process crash on Redis disconnect.
- `middleware/geo-block.ts:18` — returns `void` after `c.body(...)` instead of `return c.json({…}, 451)`; header-only trust (`CF-IPCountry`) is bypassable unless the API is reachable **only** via Cloudflare. Compliance-critical — keep the CDN-layer block as the primary gate (CLAUDE.md already prefers Cloudflare Workers).
- error-envelope mismatch: routes return bare `{ error }`, but `apps/game/lib/api.ts` parses every response as the `ApiResult<T>` envelope → errors silently pass `if (!parsed.ok)` and crash downstream.

### `@fairground/keeper`

- **`pino` imported in two files but absent from `package.json`** → module-not-found.
- `lock.ts:40-46` & `:53-56` — **non-atomic** `GET`+`PEXPIRE` / `GET`+`DEL` (Redlock TOCTOU): a refresh can extend a thief's lock, a release can delete another instance's lock. Use atomic `GETEX` / a Lua check-and-act.
- `resolver.ts` — core `resolve()` is a **placeholder** (awaiting generated client; expected). But sessions set to `state='resolving'` are **never re-queued** if the keeper dies mid-flight (the query only selects `'pending'`). Add a recovery sweep for `'resolving'` older than N minutes.
- `tsx` is a **production** dependency; it belongs in devDependencies (the container runs compiled output).

### `@fairground/db`

- **Zero uniqueness constraints.** Spec requires idempotency on `beaconRound + wallet + nonce`; schema has no `uniqueIndex`. `bets.txnId` and `sessions(walletAddress, commitRound)` should be unique to prevent duplicate bet rows / double-payout. `bets.bet_id` FK on `sessions` lacks an index.

### `apps/game` + `apps/landing`

- **Player pick (heads/tails) is never sent to the server** (`CoinflipGame.tsx`): `SubmitBetParams` has no `pick`; the result display hardcodes "Heads — You Won" regardless. Outcome rendering will be wrong.
- **`Buffer.from()` used in a browser component** (`CoinflipGame.tsx:184`) → runtime crash off-Node.
- **`BOX_MBR` is hardcoded `36_900n`** in `CoinflipGame.tsx:25` vs the contract's **49,700** → every `flip()` reverts ("payment too small to cover MBR"). The frontend constant predates the `referrer` field.
- **`apps/landing/src/styles/global.css` is never imported** → all custom OKLCH tokens are dead.
- **Scroll-reveal is broken**: `global.css` sets `[data-reveal]{opacity:0}` but no `IntersectionObserver` adds `.revealed` → marked elements are invisible to bots/SSR/no-JS. Content must be visible by default; animation additive.
- **No `prefers-reduced-motion` guard** anywhere (ember cursor trail runs unconditionally).
- `LiveStats.tsx` / `ProofCardDemo.tsx` are **orphaned** (no Astro page imports them); `ProofCardDemo` double-scales to 25%.
- **Dead AlgoExplorer links** (`algoexplorer.io` shut down 2024) in `CoinflipGame.tsx:501`, `landing/index.astro:17`, `proof-card/.../VrfResultCard.tsx:167` → use `allo.info` or `explorer.perawallet.app`.
- **Good:** RSC/client boundaries, use-wallet v4 `WalletManager` wiring, OKLCH token values, bigint-as-string on the wire, and `useRelayerWake.ts` (the CLAUDE.md "port from metafarm" task is **already done** and the v4 `wallet.reconnect()` approach is safer than metafarm's raw `restartTransport()`).

---

## 4. Config & infrastructure (P0)

| Sev | Finding                                                                                                                                                                                                                         | Fix                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | **`docker-compose.yml:127` `internal: true`** on the only network blocks all outbound traffic → API & keeper can't reach AlgoNode algod/indexer → the chain is unreachable in production; the keeper hangs on every `status()`. | Remove `internal: true` (DB/Redis ports aren't published, so no new exposure), or add a second non-internal `fairground-external` network for api+keeper. |
| P0  | **`vitest.workspace.ts` references 8 `vitest.config.ts` files that don't exist** → `pnpm vitest` hard-fails.                                                                                                                    | Create per-package configs or switch to a glob/inline workspace.                                                                                          |
| ✅  | **`.mcp.json` `vestige` pointed at `@goplausible/vestige-mcp` (404 — does not exist).** Correct package is unscoped **`vestige-mcp@1.3.0`**.                                                                                    | **Fixed this session.** (Note: v1.3.0 is ~13 months old — verify it still loads.)                                                                         |
| ✅  | **pnpm 11 build-script gate.**                                                                                                                                                                                                  | **Fixed:** `onlyBuiltDependencies` added to `pnpm-workspace.yaml`.                                                                                        |
| P1  | `.env.example` is missing every `NEXT_PUBLIC_*` var the game app needs (e.g. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`).                                                                                                           | Add them.                                                                                                                                                 |
| P1  | TS project references are claimed in CLAUDE.md but **absent from every tsconfig**.                                                                                                                                              | Add `references` or drop the claim.                                                                                                                       |
| P2  | `.mcp.json` pins `@playwright/mcp@latest`; `@goplausible/algorand-mcp@4.2.5` is correctly pinned and current.                                                                                                                   | Pin playwright to a version for reproducibility.                                                                                                          |

---

## 5. Docs & skills consistency

The docs are comprehensive and honest about compliance, but several numbers are stale enough to mislead anyone who follows them without reading the code.

- **MBR is wrong in 3+ places.** Ground truth (contract): **49,700** microALGO (key 37 B + value 81 B). CLAUDE.md says **35,000**; `CoinflipGame.tsx` says **36,900**; `puya-gotchas`/SKILLS.md say **35,000**; `avm-constraints.md` shows FlipState = **49 bytes** (pre-`referrer`). All must say **81 bytes / 49,700**.
- **Refund-window round math.** Game specs use `172800 rounds @ ~1s/round`; Algorand is ~2.8s/round, and the contract uses `69,120 @ 2.5s`. Reconcile to one number.
- **`Makefile` `contracts-generate` writes to the wrong dir** (`../../sdk/src/clients/` resolves to repo-root `/sdk`, not `/packages/sdk`). `.algokit.toml` and `contracts/README.md` use the correct `../../packages/sdk/...`. Align all four (SKILL.md, Makefile, `.algokit.toml`, CLAUDE.md) on one client-gen command + path.
- **BOARD.md is frozen at day zero** — all 63 tasks are `todo`, including FG-001/003/004/… that the scaffold already delivers. Reconcile status with reality, and collapse the **three duplicate p0 geo-block tasks** (FG-006/041/121) into one scoped to the Cloudflare-Worker layer.
- **Skills:** `fairground-frontend` references 3 reference files that don't exist (`wallet-integration.md`, `proof-card-share.md`, `antislop-rules.md` — only `design-system.md` is present). SKILLS.md advertises `smart-contract-audit/puya-checks.md` (the "Algorand-specific layer") which **does not exist** — the audit skill is currently chain-agnostic only. (Both addressed in §8.)

---

## 6. Research findings (web + on-chain)

### Version pins — all valid

Every npm/PyPI pin resolves to the current latest as of 2026-06-01 (algorand-python 3.5.0, puyapy 5.8.1, algokit 2.10.2, algosdk 3.5.2, algokit-utils 9.2.0, use-wallet 4.6.0, next 16.2.6, react 19.2.6, astro 6.4.2, hono 4.12.23, drizzle-orm 0.45.2, satori 0.26.0, tailwindcss 4.3.0, vite 8.0.14, vitest 4.1.7, turbo 2.9.16, …). **No hallucinated versions.** Notable:

- **ARC-56 is supported** by `algokit-client-generator@6.0.1` (official docs; the npm "ARC-0032" description is stale). **Open Question #1 is resolved — no `--output-arc32` fallback needed.** v7.0.0-beta is shipping; stay on 6.0.1.
- **ESLint 9.39.0 → EOL 2026-08-06.** Migrate to ESLint 10 (flat config already in use → low effort) before then; `typescript-eslint@8.60.0` peer range already allows ESLint 10.
- Minor: bump `tsx` 4.22.3 → 4.22.4; monitor `typescript-eslint` issue #12123 (TS 6 type-checked-lint support).

### VRF beacon — correct, with two notes

- **Mainnet 947957720 and testnet 110096026 are live** (on-chain verified, identical bytecode, populated state). The codebase's IDs work.
- **Newer doc-canonical IDs exist:** the Algorand Developer Portal cites **1615566206** (mainnet) and **600011887** (testnet). Before mainnet, test which set receives fresh proofs and update via the existing `set_beacon_app_id()` admin method if needed.
- ABI confirmed: `must_get(uint64,byte[])byte[]` (0x47c20c23, panics on missing) / `get` (0x189392c5); output = ARC-4 DynamicBytes (2-byte length prefix + 32 raw bytes). Storage window ≈ 189 outputs × 8 = 1512 rounds (~70 min). The codebase's encoding handling is correct.

### Reference repos worth reading (don't copy blindly)

| Repo                                           | Use                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `cusma/algo-dices`                             | Canonical commit-reveal against the same beacon — closest match to Fairground's pattern. **Reference.**                             |
| `algorand-devrel/coin-flipper`                 | Official DevRel VRF coinflip (PyTeal + TS). Reference the commit/settle flow; predates Puya v5 and use-wallet v4 — don't copy code. |
| `appliedblockchain/algorand-randomness-beacon` | Beacon source — verify ABI signatures & output encoding before writing integration tests (archived June 2024).                      |
| `TxnLab/use-wallet` + `next-use-wallet`        | App-Router `WalletProvider` pattern for v4.                                                                                         |

### MCP / tooling

- `@goplausible/algorand-mcp@4.2.5` — correct, current (78+ tools: algod/indexer, simulate, Tinyman, Haystack, NFD, Pera). Keep.
- `vestige-mcp` — fixed package name (§4). `@playwright/mcp` — official; pin a version.

---

## 7. Refactor-early (cheap now, expensive after more code piles on)

1. **Treasury capital flow** (§2 P0) — decide A (bets → treasury) vs B (sweep). This shapes `flip()`, `resolve()`, `refund()`, and every future game. Decide before writing game #2.
2. **`refund()` independence from treasury** (§2 P0) — rewrite to a direct payment; do it together with #1.
3. **API server rewrite to `@hono/node-server` `serve()`** (§3) — the custom handler is unsalvageable; replace before more routes are added.
4. **DB uniqueness constraints** (§3) — add now, before any rows exist, so migrations stay clean.
5. **Drop `baseUrl`, add `@types/node`, standardize tsconfig** across packages (§3) — one base fix unblocks all dts builds.
6. **Remove dead `claimed` field** & **use `arc4.abi_call` consistently** for the treasury call (§2) — before the ARC-56 ABI is frozen and clients generated.
7. **`BEACON_SETTLE_BUFFER` 2 → 4** (§2) — one-line, prevents unresolvable sessions.

---

## 8. Skills added / to add

**Added this session:**

- `fairground-landing` skill (ported from `prediction-market/.claude/skills/verdict-landing`): the 6-step understand→design→implement→review→polish→deploy workflow, taste dials, quality bar, and sub-skill orchestration — re-skinned to Fairground's dark-amber brand. (See `.claude/skills/fairground-landing/`.)
- The three missing `fairground-frontend` reference files (`wallet-integration.md`, `proof-card-share.md`, `antislop-rules.md`).

**Still missing (recommended):** Hono/API skill, keeper/VRF-resolver skill, proof-card/satori skill, Drizzle DB skill, deploy/ops skill, and the advertised `smart-contract-audit/puya-checks.md`.

---

## 9. Plan — sequenced next steps

The scaffold's own phases (BOARD.md) are right; the gap is that nothing has been made to _run_. Re-sequence around "make it compile, then make it correct, then make it pretty."

### Phase 0 — Unblock the toolchain (½ day)

- Apply the green-build recipe (§1); confirm `pnpm install` + `turbo build` green on node 22 / pnpm 11.5.
- Upgrade Docker compose ≥ 2.5.0; `algokit localnet start`.
- Fix the §4 P0 config bugs (Docker `internal:true`, vitest configs). _(vestige-mcp + onlyBuiltDependencies already done.)_

### Phase 1 — Contracts compile + correct (FG-001/002/010/012/013/014)

- Fix the 3 compile-error classes (§2a–c) → `algokit compile` green.
- Decide & implement treasury capital flow (A) + treasury-independent `refund()`.
- `BEACON_SETTLE_BUFFER → 4`; remove `claimed`; `emergency_withdraw` timelock; MBR-payment enforcement.
- **Write real tests** (replace all `pytest.skip`); kill-the-mutant the solvency + idempotency + refund + auth invariants.
- `algokit generate client` → populate `packages/sdk/src/clients/`; unblock keeper + game TODOs.

### Phase 2 — TS correctness (FG-040/050/060/070)

- SDK: `fromConfig`, `lastRound`, `@types/node`, drop `baseUrl`.
- API: rewrite server (`serve()`), fix `eq` import, ws error handler, error envelope.
- Keeper: add `pino` dep, atomic lock, `resolving` recovery, real `resolve()` via generated client.
- DB: unique constraints + migration.
- Game: send `pick`, fix `BOX_MBR=49_700n`, remove `Buffer`, import `global.css`, fix explorer links.

### Phase 3 — Brand, landing, compliance (FG-110/120)

- Build the landing with the new `fairground-landing` skill (scroll-reveal + reduced-motion fixes); wire `global.css`; SEO meta; OG generation.
- Stand up the Cloudflare-Worker geo-block (the only compliance-grade layer) and verify the Thai block **before** any public post.

### Phase 4 — Deploy + verify

- Docker stack up on the Hostinger Fairground stack; health checks; proof-card endpoint public before the first tweet.

---

## Appendix — changes applied during this audit

- `pnpm-workspace.yaml` — added `onlyBuiltDependencies: [esbuild, sharp]` (pnpm 11 build-script approval).
- `.mcp.json` — `vestige` package `@goplausible/vestige-mcp` → `vestige-mcp` (the scoped name 404s).
- `.claude/skills/fairground-landing/**` — new skill ported from `verdict-landing`.
- `.claude/skills/fairground-frontend/reference/{wallet-integration,proof-card-share,antislop-rules}.md` — the three files the skill already referenced.
- `pnpm-lock.yaml` — generated by the install (left in place; commit it).

No source code (contracts, API, keeper, apps) was modified — those fixes are sequenced in §9 for deliberate, tested change.

**2026-06-01 (session 2) — contracts rewrite + client generation + sdk fix:**

- All three Puya contracts (`house_treasury`, `coinflip`, `leaderboard`) rewritten to fix the three compile-error classes (2a/2b/2c): module-level constants converted to `typing.Final` int literals; `_` throwaway names replaced with real identifiers; struct-valued `BoxMap.maybe()` calls replaced with index access + `.copy()`.
- `refund()` rewritten to pay bet + BOX_MBR directly from the coinflip contract's own balance — no treasury dependency. Resolves P0 finding "refund backdoor breaks when treasury is paused."
- Treasury capital flow decided and implemented (Open Question #5 resolved): bets escrow in coinflip contract, swept to `house_treasury` on `resolve()`, winners paid from treasury.
- `BEACON_SETTLE_BUFFER` raised from 2 to 4 in both `coinflip.py` and `beacon.ts`.
- Dead `claimed` field removed from `FlipState`. `FlipState` is now 80 bytes (`vrf_round8 + bet_amount8 + salt_hash32 + referrer32`). `BOX_MBR` updated to 49,300 microALGO.
- `algokit compile python` green on all three contracts (puyapy 5.8.1). ARC-56 artifacts generated to `packages/contracts/artifacts/`.
- `algokit generate client` run against all three artifacts. ARC-56 input confirmed accepted by `algokit-client-generator@6.0.1` (resolves Open Question #1). Six clients generated in `packages/sdk/src/clients/`: `CoinflipContractClient`, `CoinflipContractFactory`, `HouseTreasuryClient`, `HouseTreasuryFactory`, `LeaderboardContractClient`, `LeaderboardContractFactory`.
- `@fairground/sdk` sdk package fixes applied (algosdk v3 `lastRound` camelCase, `AlgorandClient.fromConfig()`, `@types/node` added). `@fairground/sdk` typechecks green.
- Docs, skills, and BOARD.md updated to match the rewritten contracts (this session).
