---
name: fairground-contract
description: Fairground Puya contract reference skill. Load before writing any algopy 3.5.0 / puyapy 5.8.1 contract code. Orchestrates puya-gotchas check, loads reference files, enforces kill-the-mutant test discipline.
user-invokable: true
---

# Fairground Contract Skill

Load before writing or modifying any Puya contract in `packages/contracts/smart_contracts/`.

## When to invoke

- Starting any work on `coinflip/contract.py`, `house_treasury/contract.py`, or `leaderboard/contract.py`
- Adding a new game contract
- Reviewing contract logic for correctness or security

## Read these references before acting

| File                           | When to load                                        |
| ------------------------------ | --------------------------------------------------- |
| `reference/avm-constraints.md` | Always -- box MBR, group limits, inner txn limits   |
| `reference/vrf-integration.md` | Any VRF-related code (commit, resolve, beacon call) |
| `reference/house-pool-math.md` | Solvency invariant, payout math, bet limits         |
| `reference/compliance-ops.md`  | Foundation framing, geo-block, grant strategy       |

Always invoke `/puya-gotchas` before writing any new Puya code.

## Workflow

```
1. Invoke /puya-gotchas (check all 12 named pitfalls)

2. Load reference files relevant to the task:
   - Always: reference/avm-constraints.md
   - VRF code: reference/vrf-integration.md
   - Payout logic: reference/house-pool-math.md

3. Write/modify contract
   - Use arc4.Address for BoxMap keys (not Bytes) -- avoids ARC-4 length prefix mismatch
   - Box deletion order is asymmetric, don't generalize a single rule: resolve() submits every
     inner transfer, THEN deletes the box, THEN returns its MBR last; refund() deletes the box
     BEFORE its one combined payment. See AGENTS.md Critical invariants for the code-verified
     sequence before changing either.
   - MBR = 2500 + 400*(prefix_len + key_len + val_len) -- include prefix

4. Verify compilation (per contract, with --out-dir -- without it puyapy 5.8.1 writes beside
   contract.py, not into artifacts/)
   cd packages/contracts && algokit compile python smart_contracts/<contract>/contract.py --out-dir artifacts

5. Run tests
   python -m pytest tests/ -v
   # Kill-the-mutant check: comment out a key assertion, confirm at least one test fails

6. Generate TypeScript clients (after any ABI changes), from repo root
   make contracts-generate

7. Commit with update to BOARD.md task status
```

## Contract Architecture

```
HouseTreasury (deploy first)
  |-- pay_winner(address, amount) -- called by game contracts as inner txn
  |-- registered_games: BoxMap[arc4.Address, UInt64] -- game registry
  |-- solvency: payout <= max_payout_bps * spendable_balance / 10000

CoinflipContract (depends on HouseTreasury)
  |-- flip(salt_hash, referrer) -- group txn[0]=payment, txn[1]=app_call
  |-- resolve(player) -- permissionless, reads VRF beacon via arc4.abi_call
  |-- refund() -- player-only, available 48h after commit_round passes
  |-- flips: BoxMap[arc4.Address, FlipState] -- one per active player

LeaderboardContract (optional, enabled via set_leaderboard_app_id)
  |-- record_result(player, won, bet_amount, payout, jackpot_hit)
  |-- stats: BoxMap[arc4.Address, WalletStats]
```

## Key Invariants

1. Box deletion is the idempotency guard (non-existence = already settled), but it is NOT the last step: resolve() submits every payout transfer, deletes the box, then returns the box MBR; refund() deletes the box, then makes one combined bet+MBR payment (coinflip/contract.py:264-265, 285-286)
2. Solvency check at resolve() time, not at flip() time
3. Beacon round: commit to N+8 (ceil8 semantics), resolve after N+10 (N+8+2 buffer)
4. 48h refund backdoor in every game contract -- keeper failure must never lock funds
5. HouseTreasury must be deployed before any game contract
