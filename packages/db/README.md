# @fairground/db

Drizzle ORM 0.45.2 schema and pg 8.21.0 client for Fairground.

## Tables

| Table | Purpose |
|---|---|
| `bets` | One row per bet. All microALGO amounts as `bigint`. |
| `sessions` | Keeper state machine — one session per active bet. |
| `jackpot` | Per-game jackpot pool state. |
| `leaderboard_snapshots` | Periodic off-chain snapshots of on-chain leaderboard boxes. |

## Usage

```ts
import { createDb, bets, sessions } from '@fairground/db';
import { eq } from 'drizzle-orm';

const db = createDb(process.env.DATABASE_URL);
const pending = await db.select().from(sessions).where(eq(sessions.state, 'pending'));
```

## Migrations

```bash
# Generate migration SQL from schema diff
pnpm db:generate

# Apply migrations to the database
pnpm db:migrate

# Push schema directly (dev only, skips migration history)
pnpm db:push
```

Set `DATABASE_URL` before running any drizzle-kit command.
