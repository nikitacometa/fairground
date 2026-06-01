---
name: puya-gotchas
description: Named Puya/AVM pitfalls with before/after code. Invoke before writing any algopy 3.5.0 / puyapy 5.8.1 contract code to prevent an entire class of runtime failures.
user-invokable: true
---

# Puya Gotchas

Named pitfalls with before/after code patterns. All verified against algopy 3.5.0 / puyapy 5.8.1.

---

## 1. `algopy.Literal` does not exist

**Problem:** `arc4.StaticArray[arc4.Byte, algopy.Literal[32]]` fails to compile.
`algopy.Literal` is not exported from the algopy module.

```python
# WRONG -- compilation error
salt_hash: arc4.StaticArray[arc4.Byte, algopy.Literal[32]]
```

```python
# CORRECT -- use typing.Literal
import typing
salt_hash: arc4.StaticArray[arc4.Byte, typing.Literal[32]]
```

---

## 2. `arc4.Int64` does not exist

**Problem:** `arc4.Int64` is not in algopy 3.5.0 stubs. Only unsigned arc4 types exist.

```python
# WRONG -- puyapy type error
class Stats(arc4.Struct):
    net_pnl: arc4.Int64   # does not exist
```

```python
# CORRECT -- split into two UInt64 fields, compute net off-chain
class Stats(arc4.Struct):
    wins_amount: arc4.UInt64      # cumulative payouts received
    losses_amount: arc4.UInt64    # cumulative bets lost
# Off-chain: net_pnl = wins_amount - losses_amount
```

---

## 3. `op.AppParam.address()` does not exist

**Problem:** `op.AppParam.address(app_id)` is not a valid algopy call.

```python
# WRONG -- runtime panic
game_addr = op.AppParam.address(game_app_id.native)
```

```python
# CORRECT
game_addr_raw, exists = op.AppParamsGet.app_address(game_app_id.native)
assert exists, "app does not exist"
```

---

## 4. `op.Global.current_application_address` is not valid

**Problem:** `op.Global.current_application_address` does not exist.
The `Global` class is the high-level re-export from `algopy`, not `op.Global`.

```python
# WRONG
balance = op.Global.current_application_address.balance
```

```python
# CORRECT
from algopy import Global
app_account = Global.current_application_address  # Account type
balance = app_account.balance
spendable = balance - app_account.min_balance     # exclude non-spendable MBR
```

---

## 5. Box MBR must account for key_prefix

**Problem:** BoxMap with `key_prefix` adds prefix bytes to on-chain key length.
MBR formula ignores the prefix bytes → MBR too low → txn fails.

```python
# WRONG -- ignores 5-byte prefix "flip:" and uses stale FlipState size
# key_len = 32, val_len = 80 → MBR = 2500 + 400*(32+80) = 47300 (missing prefix)
BOX_MBR = UInt64(35_000)  # wrong
self.flips = BoxMap(arc4.Address, FlipState, key_prefix=b"flip:")
```

```python
# CORRECT -- prefix "flip:" = 5 bytes; FlipState = 80 bytes (no 'claimed' field)
# key_len = 5 + 32 = 37, val_len = 80 → MBR = 2500 + 400*(37+80) = 49300
BOX_MBR: typing.Final = 49_300
self.flips = BoxMap(arc4.Address, FlipState, key_prefix=b"flip:")
# Use at call site: UInt64(BOX_MBR)
```

**Formula:** `MBR = 2500 + 400 * (prefix_len + key_len + val_len)`

---

## 6. BoxMap key type `Bytes` vs `arc4.Address` encoding

**Problem:** `BoxMap(Bytes, ...)` uses ARC-4 encoding for the key: 2-byte length prefix + raw bytes.
`BoxMap(arc4.Address, ...)` stores exactly 32 bytes (no length prefix).
Using raw `op.Box.get()` with a different encoding than the BoxMap writes fails.

```python
# WRONG -- key encoding mismatch
self.registered_games = BoxMap(Bytes, UInt64, key_prefix=b"game:")
# Writes key with 2-byte ARC-4 length prefix: b'\x00\x20' + 32_bytes
# Then reads with:
registered, flag = op.Box.get(b"game:" + caller_addr)  # missing length prefix -> fails
```

```python
# CORRECT -- use arc4.Address key (no ARC-4 length prefix)
self.registered_games = BoxMap(arc4.Address, UInt64, key_prefix=b"game:")
# Then read via BoxMap abstraction:
caller_key = arc4.Address(Txn.sender.bytes)
registered, flag = self.registered_games.maybe(caller_key)
```

---

## 7. VRF beacon is an ABI method, not a box named `b"V"`

**Problem:** The Applied Blockchain beacon does not expose a box named `b"V"`.
It exposes an ARC-4 ABI method: `must_get(uint64,byte[])byte[]`.

```python
# WRONG -- beacon has no box named "V"
beacon_output = op.Box.get(b"V")  # always fails
```

```python
# CORRECT -- call the ABI method
randomness, _txn = arc4.abi_call[arc4.DynamicBytes](
    "must_get(uint64,byte[])byte[]",
    arc4.UInt64(commit_round),
    arc4.DynamicBytes(Bytes(b"")),        # empty user_input for coinflip
    app_id=algopy.Application(self.beacon_app_id.value),
    fee=UInt64(0),
)
# ARC-4 byte[] = 2-byte big-endian length prefix + raw bytes
beacon_output = randomness.bytes[2:]     # 32 raw VRF bytes
```

---

## 8. Box deletion before resolution = idempotency bug

**Problem:** Deleting the box before executing inner txns breaks idempotency.
If the keeper retries after a partial failure, the box is gone and the player
cannot be paid (double-delete panic) or refunded.

```python
# WRONG -- delete before inner txns
mutable_state.claimed = arc4.Bool(True)
self.flips[player] = mutable_state    # write claimed=True
del self.flips[player]                # delete box BEFORE paying winner
itxn.ApplicationCall(pay_winner...).submit()  # too late if this panics
```

```python
# CORRECT -- execute all inner txns, then delete box last
itxn.ApplicationCall(pay_winner...).submit()   # pay winner first
# Box deletion is the idempotency guard -- non-existence = already resolved
del self.flips[player]                         # delete LAST
```

---

## 9. Commit round must be N+8, not N+4

**Problem:** N+4 can arrive before the player's flip() txn confirms under congestion.
The bet would commit to a round that has already passed.

```python
# WRONG -- too short, race condition under congestion
commit_round = Global.round + UInt64(4)
```

```python
# CORRECT -- N+8 is the minimum safe value
BEACON_DELAY = UInt64(8)
commit_round = Global.round + BEACON_DELAY
```

---

## 10. Beacon retention window: 70 minutes, not unlimited

**Problem:** The beacon stores only the last 189 VRF outputs (~70 min at 2.8s/block).
`must_get()` panics on stale rounds. Keeper must resolve within 60 min.

```python
# WRONG ASSUMPTION -- beacon output is available forever
# "We'll resolve it when we get around to it"
```

```
CORRECT operational constraint:
- Keeper SLA: resolve all sessions within 60 min of commit_round passing
- Monitor pending sessions; alert at 45 min
- At 48h elapsed: player can call refund() (contract backdoor)
- At 70 min without resolution: must_get() panics, session becomes unresolvable
  without the refund path
```

---

## 11. ARC-56 generated clients: never edit by hand

**Problem:** Editing `packages/sdk/src/clients/` manually gets overwritten
on the next `algokit generate client` run.

```
# WRONG
vim packages/sdk/src/clients/CoinflipContractClient.ts  # manual edit
```

```bash
# CORRECT -- regenerate from ARC-56 artifacts
algokit generate client packages/contracts/artifacts/ --output packages/sdk/src/clients/
```

---

## 13. Module-level constants must be `typing.Final` int literals

**Problem:** Module-level `X: UInt64 = UInt64(n)` is not a compile-time constant in puyapy 5.8.1. The compiler raises `Unable to resolve global constant reference` when the constant is used inside a method.

```python
# WRONG -- puyapy cannot resolve UInt64(...) at module scope
BOX_MBR: UInt64 = UInt64(49_300)
BEACON_SETTLE_BUFFER: UInt64 = UInt64(4)

class CoinflipContract(ARC4Contract):
    def flip(self, ...):
        assert payment.amount >= UInt64(BOX_MBR)  # error: cannot resolve
```

```python
# CORRECT -- plain typing.Final int literal; wrap with UInt64() at use sites
import typing

BOX_MBR: typing.Final = 49_300
BEACON_SETTLE_BUFFER: typing.Final = 4

class CoinflipContract(ARC4Contract):
    def flip(self, ...):
        assert payment.amount >= UInt64(BOX_MBR)  # compiles fine
```

This applies to every module-level constant in all three contracts (`house_treasury.py`, `coinflip.py`, `leaderboard.py`).

---

## 14. `BoxMap.maybe()` on a struct value cannot be tuple-unpacked

**Problem:** When the `BoxMap` value type is an `arc4.Struct`, the result of `.maybe()` is a mutable reference to an ARC-4-encoded value. Tuple unpacking (`state, exists = self.flips.maybe(player)`) raises a compile error: `tuples containing a mutable reference to an ARC-4-encoded value cannot be unpacked`. Using `_` as a throwaway name is also rejected.

```python
# WRONG -- tuple unpack fails on struct-valued BoxMap
state, exists = self.flips.maybe(player)  # compile error

# ALSO WRONG -- _ is not a valid variable name in puyapy
_, exists = self.flips.maybe(player)      # compile error
```

```python
# CORRECT -- use index access; call .copy() on the struct to get a mutable snapshot
result = self.flips.maybe(player)
exists = result[1]
if exists:
    state = result[0].copy()
    # work with state...

# ALSO CORRECT for existence-only checks (no struct access needed)
exists = player in self.flips
```

For scalar-valued `BoxMap` (e.g. `BoxMap(arc4.Address, UInt64, ...)`), `.maybe()` tuple unpacking works normally. The restriction applies only to struct values.

---

## 12. Always `simulate()` before `send()` on non-trivial paths

```typescript
// CORRECT pattern for keeper and frontend before mainnet spend
const atc = new algosdk.AtomicTransactionComposer();
// ... add txns to atc ...
const simResult = await atc.simulate(
  algodClient,
  new algosdk.SimulateRequest({
    txnGroups: [],
    allowUnnamedResources: true,
  }),
);
// Check simResult for errors before calling atc.execute()
await atc.execute(algodClient, 4);
```
