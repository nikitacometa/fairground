# VRF Integration Reference

How to call the Algorand VRF randomness beacon (Applied Blockchain) from Puya contracts.

---

## Beacon App IDs

| Network | App ID | Status |
|---------|--------|--------|
| Mainnet | **947957720** | Confirmed canonical. Defined as `MAINNET_BEACON_APP_ID = 947957720n` in `packages/sdk/src/vrf/beacon.ts`. |
| Testnet | **600011887** | Verified testnet app ID as of May 2026. Use for integration tests against testnet. |

Both apps implement **ARC-0062**: `get(round: uint64, user_data: byte[]) -> byte[32]`.

The call is free (no fee to the beacon app itself). The outer txn must cover the inner txn gas via `fee=0` pooling (see puya-gotchas G-2).

---

## Commit-Reveal Pattern

### Phase 1: Commit (player's bet transaction)

The player submits a payment transaction. The contract stores:
- `beacon_round = Global.round + 8` — the round after which the beacon output is readable
- `session_nonce` — 32 bytes of entropy from `op.sha256(txn.tx_id + player.bytes)` or similar
- `bet_amount` — from the payment amount minus box MBR
- `claimed = False`

**Minimum commit round is N+8.** N+4 risks arrival before the bet transaction confirms under congestion (2.8s average block time is not a hard guarantee). Never reduce this parameter.

### Phase 2: Resolve (keeper or player call — permissionless)

Any wallet can call `resolve()` once `Global.round >= beacon_round`. The contract:

1. Loads the bet box.
2. Asserts `not bet_data.claimed`.
3. Calls the VRF beacon via inner transaction.
4. Hashes the beacon output with the session nonce for game-specific randomness.
5. Determines the outcome.
6. Pays out from house treasury if player wins.
7. Sets `claimed = True`, then deletes the box.

### Verified inner call pattern (Puya)

```python
from algopy import (
    ARC4Contract,
    UInt64,
    Bytes,
    Application,
    arc4,
    op,
    Global,
)

# Beacon ABI signature: get(uint64,byte[])byte[]
# ARC-0062

MAINNET_BEACON_APP_ID: Final[UInt64] = UInt64(947_957_720)

@subroutine
def _get_vrf_output(self, beacon_round: UInt64, user_data: Bytes) -> Bytes:
    result, _txn = arc4.abi_call(
        "get(uint64,byte[])byte[]",
        beacon_round,
        arc4.DynamicBytes(user_data),
        app_id=Application(MAINNET_BEACON_APP_ID),
        fee=0,  # must be 0 — pool from outer txn
    )
    return result.bytes

@subroutine
def _derive_outcome(self, beacon_output: Bytes, session_nonce: Bytes) -> UInt64:
    # Hash beacon output with session nonce for game randomness
    # This prevents the beacon operator from knowing which game benefits from which output
    mixed = op.sha256(beacon_output + session_nonce)
    # For coinflip: take first 8 bytes as uint64, mod 10000
    # < 4900 = player wins (49% — 2% edge)
    # >= 4900 = house wins
    raw = op.btoi(mixed[:8])
    return raw % UInt64(10_000)
```

### Minefield cell expansion

For Algo Minefield, a single 32-byte beacon output provides enough entropy for the full 5x5 grid (25 cells). Use deterministic expansion:

```python
@subroutine
def _expand_to_grid(self, beacon_output: Bytes) -> Bytes:
    # 25 cells: hash beacon_output + cell_index for each cell
    # Returns 25 bytes — one per cell, 0x00=safe, 0x01=mine
    # Probability of mine per cell is set by mines_count parameter
    cells = Bytes()
    i = UInt64(0)
    while i < 25:
        cell_hash = op.sha256(beacon_output + op.itob(i))
        # Use first byte mod 25 to determine if cell is a mine
        # For 5 mines: if op.btoi(cell_hash[:1]) % 25 < 5 → mine
        cells = cells + cell_hash[:1]
        i += 1
    return cells
```

This is client-side logic for display purposes. The contract only stores the beacon output and the player's revealed cells — it never iterates 25 cells in a single app call (would exceed box ref budget).

---

## 48-Hour Refund Backdoor (Required)

If the keeper fails to call `resolve()` for 48 hours after the commit round passes, the player must be able to reclaim their bet unilaterally. This prevents keeper downtime from locking player funds.

```python
REFUND_WINDOW_SECONDS: Final[UInt64] = UInt64(172_800)  # 48 hours

@arc4.abimethod
def refund(self, player: arc4.Address) -> None:
    key = player.bytes
    exists, _ = op.Box.length(key)
    assert exists, "no active bet"
    bet_data = arc4.decode(BetData, op.Box.get(key)[0])
    assert not bet_data.claimed, "already claimed"
    # Require that the commit round has passed AND 48h wall-clock has elapsed
    assert Global.round > bet_data.beacon_round, "beacon round not yet passed"
    assert (
        Global.latest_timestamp >= bet_data.commit_timestamp + REFUND_WINDOW_SECONDS
    ), "refund window not yet open"
    # Refund bet + MBR
    itxn.Payment(
        receiver=player.native,
        amount=bet_data.bet_amount + BOX_MBR,
        fee=0,
    ).submit()
    bet_data.claimed = arc4.Bool(True)
    op.Box.replace(key, 0, bet_data.bytes)
    op.Box.delete(key)
```

---

## Idempotency Key

The combination of `beacon_round + player_address + session_nonce` is the idempotency key. The `claimed` flag ensures the resolve path is safe to retry — a second call finds `claimed=True` and rejects.

---

## TS Client Pattern (packages/sdk)

```typescript
// packages/sdk/src/vrf/beacon.ts
export const MAINNET_BEACON_APP_ID = 947_957_720n;
export const TESTNET_BEACON_APP_ID = 600_011_887n;

export function getBeaconAppId(network: 'mainnet' | 'testnet'): bigint {
  return network === 'mainnet' ? MAINNET_BEACON_APP_ID : TESTNET_BEACON_APP_ID;
}
```

The generated ARC-56 client for the coinflip contract handles the inner beacon call inside the contract — the TS layer only needs to call `coinflipClient.resolve({ player, beaconRound })`.
