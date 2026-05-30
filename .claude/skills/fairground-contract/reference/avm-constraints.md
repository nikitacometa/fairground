# AVM Constraints Reference

Hard limits of the Algorand Virtual Machine as of AVM v10 (current on mainnet). These are not configurable — they cause transaction rejection when exceeded.

---

## Group Size

- **Max transactions per atomic group:** 16
- Applies to the outer group. Inner transactions are counted separately.

## Inner Transactions

- **Max inner transactions per app call:** 256
- All inner txns in a single call share this budget.
- Setting `fee=0` on inner txns is required — pool fees from the outer txn (see puya-gotchas G-2).
- Inner txns execute atomically and immediately — no "pending" inner txn state across calls.

## Box Storage

### Size limits

- **Max box size:** 2500 bytes
- **Max box references per app call:** 8 (counts as 2 I/O references each)
- **Max key length:** 64 bytes

### MBR formula

```
MBR = 2500 + 400 * (key_length_bytes + value_length_bytes)   [microALGO]
```

The MBR must be funded in the same transaction that creates the box. The transaction fails with `invalid box reference` if the MBR is not present in the contract account before box creation.

### CometaFlip box MBR (for reference)

| Field | Size |
|-------|------|
| key (player address) | 32 bytes |
| beacon_round | 8 bytes |
| bet_amount | 8 bytes |
| session_nonce / salt | 32 bytes |
| claimed flag | 1 byte |
| **value total** | **49 bytes** |

```
MBR = 2500 + 400 * (32 + 49) = 2500 + 32400 = 34,900 microALGO
```

Assert this in `flip()`:
```python
BOX_MBR: Final[UInt64] = UInt64(34_900)
assert payment.amount >= self.min_bet_microalgo + BOX_MBR
```

## Account State

- **Max global state:** 64 key-value pairs (configurable at creation, up to this max)
- **Max local state per account:** 16 key-value pairs (must opt in)
- Prefer box storage for per-player state — no opt-in required, no 64-account limit.

## ABI

- ARC-4 ABI method selector: 4-byte prefix of SHA-512/256 of the method signature.
- puyapy 5.8.1 outputs ARC-56 JSON by default. `algokit-client-generator@6.0.1` consumes it.

## Opcode Budget

- **Default:** 700 opcode units per call
- **Extended (pooled):** can be increased via fee overpayment. Each additional `min_txn_fee` paid adds 700 more units. Inner app calls also pool budget.
- Complex VRF resolution (inner beacon call + leaderboard update + payout) may require fee boosting. Simulate first to observe actual budget consumption.
