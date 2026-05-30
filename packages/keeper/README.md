# @fairground/keeper

VRF resolver for Fairground. Polls Postgres for pending coinflip sessions and calls `CoinflipContract.resolve(player)` once the VRF beacon round has passed.

## Two-instance redundancy

Two instances run at all times (`KEEPER_INSTANCE_ID=primary` and `KEEPER_INSTANCE_ID=standby`). Only the instance holding the Redis leader lock `keeper:lock` actively resolves sessions. The standby polls every 4 seconds, ready to take over within one tick if the primary dies.

Lock mechanics:
- Acquired with `SET keeper:lock <instanceId> NX PX 10000` — atomic, no SETNX+EXPIRE race.
- Refreshed every 4 seconds via Lua script (atomic check-then-pexpire).
- Released on clean shutdown via Lua script (check-then-del).

If the leader crashes without releasing the lock, the standby takes over after at most 10 seconds (the lock TTL).

## Polling loop

Tick interval: **4 seconds**. Each tick:
1. Refresh (or acquire) the leader lock.
2. Query Postgres for sessions where `commit_round + 3 <= current_algod_round` and `state = 'pending'`.
3. Atomically transition each session to `'resolving'` (prevents double-work across instances).
4. Submit `CoinflipContract.resolve(player)` to algod, wait for confirmation.
5. Update `bets.outcome`, `bets.resolve_txn_id`, `bets.resolved_at`.
6. Update `sessions.state = 'resolved'`.
7. Publish a `resolved` event to Redis channel `fg:events` (API WebSocket fans out to clients).

## 48-hour player refund backdoor

If the keeper is offline for more than **48 hours** (34,560 rounds), players can call `CoinflipContract.refund()` themselves — a permissionless method that returns their bet + box MBR without requiring the keeper. Funds are never permanently locked regardless of keeper uptime.

The VRF beacon retains outputs for **1512 rounds** (~70 minutes). Sessions older than 70 minutes cannot be resolved by the keeper even if it comes back online. Operator alert threshold: any session unresolved after 55 minutes.

## Environment

All variables defined in `.env.example` at the repo root. Validated at startup via `KeeperEnvSchema` from `@fairground/types`.

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | ioredis connection string |
| `ALGOD_URL` | Algorand node URL |
| `HOUSE_SEED_WALLET_MNEMONIC` | 25-word mnemonic, signs all `resolve()` calls |
| `KEEPER_INSTANCE_ID` | `primary` or `standby` |
| `COINFLIP_APP_ID` | Deployed contract bigint app ID |
| `HOUSE_TREASURY_APP_ID` | Deployed treasury bigint app ID |
| `VRF_BEACON_APP_ID` | `947957720` on mainnet |

**Never commit `HOUSE_SEED_WALLET_MNEMONIC` to git.** The pre-commit hook in `.husky/pre-commit` guards against it.

## Startup sequence

1. Validate env (exit on failure).
2. Run Drizzle migrations (`packages/db/drizzle/`) — idempotent, safe to run on both instances concurrently.
3. Load house wallet from mnemonic.
4. Enter polling loop.

## Development

```bash
# From repo root
pnpm dev --filter @fairground/keeper

# Standalone
cd packages/keeper
tsx watch src/index.ts
```

Requires Postgres, Redis, and a running LocalNet (AlgoKit) with deployed contracts.

## Relation to the API

- The API creates the initial pending `sessions` row on `POST /games/:gameId/bets`.
- The keeper transitions `sessions.state`: pending → resolving → resolved.
- The keeper publishes to `fg:events`; the API WebSocket fans out to clients.
- The keeper never builds unsigned txn groups for players — that is the API's job.
