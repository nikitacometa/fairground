# AVM Constraints Reference

## Box Storage

| Constraint                      | Value                              | Notes                                          |
| ------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Max box size                    | 32,768 bytes                       | But 2500 bytes is the practical solvency limit |
| Max box references per app call | 8                                  | Including boxes touched by inner txns          |
| MBR formula                     | `2500 + 400 * (key_len + val_len)` | key_len includes BoxMap key_prefix bytes       |

### MBR Quick Reference (Fairground contracts)

| BoxMap                          | Prefix        | Key               | Value            | On-chain key len | MBR    |
| ------------------------------- | ------------- | ----------------- | ---------------- | ---------------- | ------ |
| coinflip.flips                  | `flip:` (5)   | arc4.Address (32) | FlipState (80)   | 37               | 49,300 |
| house_treasury.registered_games | `game:` (5)   | arc4.Address (32) | UInt64 (8)       | 37               | 20,500 |
| leaderboard.registered_callers  | `caller:` (7) | arc4.Address (32) | UInt64 (8)       | 39               | 21,300 |
| leaderboard.stats               | `stats:` (6)  | arc4.Address (32) | WalletStats (64) | 38               | 43,300 |

**Note:** `arc4.Address` as BoxMap key type = 32 bytes on-chain (no ARC-4 length prefix).
`Bytes` as BoxMap key type = 2-byte ARC-4 length prefix + raw bytes. Use `arc4.Address`.

`FlipState` (80 bytes): `vrf_round: arc4.UInt64` (8) + `bet_amount: arc4.UInt64` (8) + `salt_hash: arc4.StaticArray[arc4.Byte, typing.Literal[32]]` (32) + `referrer: arc4.Address` (32). No `claimed` field — box deletion is the idempotency guard.

## Transaction Group Limits

| Constraint                        | Value                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| Max transactions per atomic group | 16                                                          |
| Max inner transactions per group  | 256                                                         |
| Max nesting depth of inner txns   | 8                                                           |
| App args max size per call        | 2048 bytes total (15 args \* 2048B each, but total ≤ 2048B) |

## Global/Local State

| Constraint                        | Value     |
| --------------------------------- | --------- |
| Max global state slots            | 64        |
| Max local state slots per account | 16        |
| Key max size                      | 64 bytes  |
| Value max size                    | 128 bytes |

## OpCodes Used in Fairground Contracts

| Opcode                  | Puya equivalent                                  | Notes                        |
| ----------------------- | ------------------------------------------------ | ---------------------------- |
| sha256                  | `op.sha256(bytes)`                               | 32-byte output               |
| getbyte                 | `op.getbyte(bytes, index)`                       | Read single byte at index    |
| itob                    | `op.itob(uint64)`                                | Integer to 8-byte big-endian |
| AppParamsGet AppAddress | `op.AppParamsGet.app_address(app_id)`            | Returns (Address, bool)      |
| balance                 | `Global.current_application_address.balance`     | Live balance                 |
| min_balance             | `Global.current_application_address.min_balance` | Non-spendable MBR            |

## ARC-4 ABI Calls (arc4.abi_call)

```python
# Pattern for cross-contract ABI calls in algopy 3.5.0
result, inner_txn = arc4.abi_call[ReturnType](
    "method_signature(arg_type1,arg_type2)return_type",
    arg1_value,
    arg2_value,
    app_id=algopy.Application(app_id_uint64),
    fee=UInt64(0),  # fee covered by outer group
)
```

For void methods: `arc4.abi_call("method(args)void", args, app_id=..., fee=UInt64(0))`
