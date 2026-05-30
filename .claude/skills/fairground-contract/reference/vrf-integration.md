# VRF Integration Reference

## Beacon Facts

| Field | Value | Source |
|-------|-------|--------|
| Mainnet app ID | 947,957,720 | Confirmed live 2026-05-30 via algod API |
| Testnet app ID | 110,096,026 | Confirmed same bytecode |
| Creator | YOVFLARZNWGKV7DAIHNK66HVYYJGYFQQIUAGWHOAMOPNOFSI5MR54ZCGMQ | algod API |
| Storage | 64 global-state byte slots | NOT boxes |
| Retention | Last 189 outputs (~70 min at 2.8s/block) | Circular array |

## ABI Methods

| Method | Selector | Behavior |
|--------|---------|---------|
| `must_get(uint64,byte[])byte[]` | `0x47c20c23` | Panics if round not stored (preferred for game contracts) |
| `get(uint64,byte[])byte[]` | `0x189392c5` | Returns empty bytes if round not stored |

Use `must_get` in game contracts -- it panics correctly if the round is too old.

## Commit-Reveal Pattern (algopy 3.5.0)

### In flip() (commit phase):
```python
BEACON_DELAY = UInt64(8)   # ceil8 semantics, must be >= 8
commit_round = Global.round + BEACON_DELAY
# Store commit_round in player box
```

### In resolve() (reveal phase):
```python
BEACON_SETTLE_BUFFER = UInt64(2)  # propagation lag
assert Global.round >= commit_round + BEACON_SETTLE_BUFFER, "not settled"

# Call beacon ABI method
randomness, _txn = arc4.abi_call[arc4.DynamicBytes](
    "must_get(uint64,byte[])byte[]",
    arc4.UInt64(commit_round),
    arc4.DynamicBytes(Bytes(b"")),        # empty user_input for coinflip
    app_id=algopy.Application(self.beacon_app_id.value),
    fee=UInt64(0),
)
# ARC-4 byte[] = 2-byte big-endian length prefix + raw 32 bytes
beacon_output = randomness.bytes[2:]     # 32 raw VRF bytes

# Outcome derivation
combined = beacon_output + state.salt_hash.bytes
outcome_hash = op.sha256(combined)
outcome = op.getbyte(outcome_hash, 0) % UInt64(2)  # 0=loss, 1=win
```

## Keeper SLA

- Keeper MUST resolve all sessions within 60 min of commit_round passing
- Beacon retention is 189 outputs = ~530 seconds = ~8.8 min... WAIT
- Recalculate: 189 outputs * 8 rounds/output_interval = 1512 rounds * 2.8s = 4234s = ~70 min
- At 70 min: must_get() panics. Session becomes unresolvable.
- At 48h: player can call refund() (contract backdoor -- always available)

Alert threshold: pending session > 45 min without resolution = PagerDuty-level alert.

## What NOT to Use

| Anti-pattern | Why |
|-------------|-----|
| `op.Box.get(b"V")` against beacon | Beacon has no box named "V". Uses ABI methods only. |
| `vrf_verify` opcode | Requires VRF proof as caller argument, reintroduces centralization |
| Gora oracle | Async request/callback flow incompatible with atomic resolve() |
| Commit delay < 8 | N+4 can arrive before flip() txn confirms under congestion |

## Minefield Extension (future)

For Minefield (multi-cell game), derive N independent outcomes from one VRF output:
```python
# Cell i outcome: sha256(beacon_output || salt_hash || itob(i))[0] % 2
cell_input = beacon_output + salt_hash + op.itob(UInt64(cell_index))
cell_hash = op.sha256(cell_input)
cell_outcome = op.getbyte(cell_hash, 0) % UInt64(2)
```
One VRF call per Minefield session; outcomes are deterministic and verifiable.
