---
paths:
  - 'packages/contracts/**'
  - 'packages/sdk/src/vrf/**'
  - 'packages/sdk/src/clients/**'
---

# Contracts, VRF and treasury — money-path invariants

Loaded automatically by Claude Code when touching contract/VRF/generated-client code. Codex does not
auto-load this file — the same content lives in `AGENTS.md`'s Critical Invariants section; read that
manually before touching these paths from Codex.

- **Never hardcode the VRF beacon app ID.** `947957720` (2022 beacon) is dead — three files in this
  repo already say so explicitly (`packages/sdk/src/vrf/beacon.ts`, `packages/types/src/version.ts`,
  `packages/contracts/smart_contracts/deploy_config.py`). Read the live ID from
  `packages/types/src/version.ts` / the deployed `.env`, every time, including inside tests.
  **Testnet is separately disputed**: `packages/sdk/src/vrf/beacon.ts`'s own comment says the testnet
  ID `110096026` is "UNVERIFIED — confirm via indexer before testnet use", while `BOARD.md` FG-011
  claims it's "on-chain verified (identical bytecode)". Before configuring TestNet or writing
  on-chain integration tests, verify that ID against an indexer yourself — don't trust either source
  as settled, and don't treat the mainnet registry as TestNet evidence.
- **Commit round:** `ceil8(current_round + BEACON_DELAY)`, `BEACON_DELAY = 8`
  (`packages/contracts/smart_contracts/coinflip/contract.py`). **Settle buffer:**
  `BEACON_SETTLE_BUFFER = 4` — `resolve()` must assert `current_round >= commit_round + BEACON_SETTLE_BUFFER`
  before calling `must_get()`. Do not reduce either constant. A premature `must_get()` (round not yet
  written) reverts the whole transaction — the box is untouched and the keeper retries later
  (`packages/keeper/src/resolver.ts` has explicit retry/reconcile handling); this is not a stranded
  session. The real permanent-loss mechanism is different: the beacon only retains its last 189
  outputs (~70 min) — if `resolve()` isn't called before that window closes, the round is evicted and
  `must_get()` panics forever (keeper marks the session `beacon_expired`; the player still has the 48h
  refund). Don't reduce `BEACON_SETTLE_BUFFER` toward that 70-minute ceiling.
- **Refund independence is load-bearing.** `refund()` pays `bet + BOX_MBR` via a direct `Payment` from
  the game contract's own balance — it must never read or debit `house_treasury`. This is what keeps
  the 48h player backdoor (`REFUND_WINDOW_ROUNDS = 61_714` rounds) working when the treasury is paused
  or insolvent. A change that routes any part of `refund()` through the treasury breaks the safety
  property the whole design depends on.
- **Solvency check timing and formula:** `HouseTreasury.pay_winner()` (not `get_available_balance()`)
  is what `resolve()` actually calls at settlement time, and it enforces
  `payout <= (balance - min_balance) * max_payout_bps // 10000` — spendable balance (gross balance
  minus the account's own minimum-balance requirement), not gross `live_balance`.
  `get_available_balance()` is a separate, advisory read (`simulate()` before accepting a bet) and is
  not itself the settlement guard — don't substitute it for `pay_winner()`'s check when reasoning
  about solvency.
- **Box deletion order — this is asymmetric between `resolve()` and `refund()`, don't generalize a
  single "always delete last" rule:**
  - `resolve()`: submit every inner transfer for that resolution (referral, jackpot accrual, treasury
    sweep, `pay_winner()` payout) first, **then** delete the session box, **then** return the box MBR
    to the player as the last payment. Deleting frees the box's reserved MBR from the contract's
    minimum-balance requirement — returning it before deletion can fail or misaccount, since that
    balance isn't spendable while the box still exists.
  - `refund()`: delete the box **before** its single combined `bet + BOX_MBR` payment (there's no
    separate MBR-return step here).
  - Either way, box deletion is the only idempotency guard (no `claimed` field) — a resolve/refund
    that runs against a missing box reverts instead of silently no-op'ing, which is what makes
    double-resolution impossible. Read the actual transfer/delete sequence in
    `coinflip/contract.py`'s `resolve()`/`refund()` before changing it; don't infer an ordering from a
    general "delete after transfers" heuristic.
- **Box MBR is a per-contract `typing.Final` constant, not a number to copy into a PR description or a
  test literal from memory.** Read it from the contract file you're editing
  (`grep -n "BOX_MBR\|_BOX_MBR" packages/contracts/smart_contracts/<contract>/contract.py`) — different
  contracts have different values (coinflip 49,300; house_treasury's game-registry box 20,500;
  leaderboard's caller box 21,300 as of this check) and they change if the box layout changes.
- **When changing transaction construction** (SDK group-building code, keeper resolve calls): the
  grouped payment into `flip()` must include the exact box MBR on top of the bet
  (`coinflip/contract.py`'s `flip()` asserts `pay.amount > BOX_MBR`); a resolve/refund group must pool
  enough fee to cover every inner transaction it triggers (referral, jackpot, treasury sweep, payout,
  MBR return can total several inner txns — `packages/keeper/src/resolver.ts` sets extra fee
  accordingly). Pending stakes stay escrowed in the game contract, not the treasury, until settlement.
  `resolve()` is permissionless by design — any account can call it, not only the keeper — so don't
  add an owner/caller check that would block a player or third party from settling their own session.
- **House edge / referral / jackpot / min-max bet / `max_payout_bps` are env/deploy-config values**
  (`packages/contracts/smart_contracts/deploy_config.py`, live `.env`), not contract-code constants and
  not numbers to trust from `docs/tokenomics.md` or the `fairground-contract` skill's
  `reference/house-pool-math.md` — both disagree with each other and with `deploy_config.py`'s
  defaults (`HOUSE_EDGE_BPS=500` / 5%, `REFERRAL_BPS=100` / 1%, `JACKPOT_BPS=150` / 1.5%;
  `docs/tokenomics.md` says 2%/0.5%, `house-pool-math.md` computes referral at 25 bps / 0.25%). Query
  the deployed contract's global state for the real value when it matters (e.g. writing payout-math
  tests or UI copy).
- **Generated clients** (`packages/sdk/src/clients/**`) come from `algokit generate client`; never
  hand-edit. Regenerate after any ABI change and re-run `packages/contracts/tests/` first.
- **`simulate()` before `send()`** on any non-trivial group built from these clients.
