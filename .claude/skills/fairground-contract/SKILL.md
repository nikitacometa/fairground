---
name: fairground-contract
description: Load Fairground contract reference material before writing any Puya contract code. Covers AVM constraints, VRF beacon integration, house pool math, and compliance ops. Runs puya-gotchas check as part of the standard workflow.
user-invokable: true
---

# Fairground Contract Skill

Load and apply Fairground-specific reference material before writing or reviewing any Puya contract code in `packages/contracts/`.

---

## When to invoke

- Before writing any new Puya contract (house_treasury, coinflip, leaderboard, minefield, or any future game)
- Before reviewing a pull request that touches `packages/contracts/`
- Before modifying VRF commit/resolve logic
- Before any mainnet deployment of a new contract version

---

## Read these references before acting

Reference files in `reference/`. Load all of them for contract work — they are short.

| File | Content |
|------|---------|
| `reference/avm-constraints.md` | Box MBR formula, group size 16, inner txn 256, box refs 8/call |
| `reference/vrf-integration.md` | Beacon app IDs, commit N+8, inner call pattern, 48h refund |
| `reference/house-pool-math.md` | 2000 ALGO seed, max bet, 2% edge, 1% max payout, auto-pause |
| `reference/compliance-ops.md` | Geo-block jurisdictions, Foundation framing rules |

Always load all four before starting contract work.

---

## Workflow

Do not skip steps:

```
1. Load references
   → Read reference/avm-constraints.md
   → Read reference/vrf-integration.md
   → Read reference/house-pool-math.md
   → Read reference/compliance-ops.md

2. Run puya-gotchas check
   → Invoke puya-gotchas skill
   → Review all 12 named gotchas against your planned contract design
   → Annotate any that apply — resolve them before writing code

3. Write contract
   → packages/contracts/smart_contracts/<game>/contract.py
   → Pin imports: from algopy import ARC4Contract, BoxMap, GlobalMap, UInt64, ...
   → Every box type: document key format, value format, and exact MBR in microALGO

4. Compile and generate
   → algokit compile python smart_contracts/
   → algokit generate client artifacts/ --output ../sdk/src/clients/
   → Never edit generated files in packages/sdk/src/clients/

5. Write tests
   → packages/contracts/tests/<game>_test.py
   → Use algorand-python-testing + LocalNet
   → Kill-the-mutant check: comment out a key line and confirm at least one test fails

6. Simulate before send
   → On all production paths, use simulate() before execute()
   → See puya-gotchas G-6

7. Commit
   → Update BOARD.md task status in the same commit
   → python -m pytest tests/ -v must pass before committing
```

---

## Contract Architecture (Fairground v1)

### Deployment order (strict)

1. `house_treasury` — must exist before any game contract
2. `coinflip` — depends on house_treasury for solvency check
3. `leaderboard` — depends on house_treasury for rake events

### Inter-contract calls

Game contracts call `house_treasury.get_available_balance()` via foreign app reference at resolve time to enforce the 1% max payout. They never hold their own long-term ALGO balance — payout comes from the treasury.

### Emergency pause

`house_treasury` exposes an `emergency_pause` global boolean. All game contracts check this flag at the start of any bet-accepting method. The flag halts bets without halting resolves — players in flight must still be able to resolve.

---

## Open Questions (resolve before coding the affected area)

1. **ARC-56 pipeline:** Verify `algokit-client-generator@6.0.1` accepts puyapy 5.8.1 ARC-56 output. Fallback: `--output-arc32` flag.
2. **TESTNET_BEACON_APP_ID:** Research cites `110096026`. Verify via `algorand` MCP `api_algod_get_application_by_id` before writing testnet integration tests.
3. **CometaFlip v1 treasury architecture:** Does coinflip hold its own ALGO balance (simpler for v1) or proxy through house_treasury (correct long-term)? The unified treasury must exist before game 2. Decide before writing the first line of Puya.
