# @fairground/types

Shared Zod 4.4.3 schemas and TypeScript types for the Fairground monorepo.

## Contents

- `GameId` enum: `coinflip`, `minefield`
- `BetOutcome` enum: `win`, `loss`, `pending`, `refunded`
- `Bet`, `BetWire` — bet record with bigint fields, wire variant serializes bigint as string
- `SessionState` enum and `Session` type — keeper state machine
- `TreasuryState`, `JackpotState` — contract state snapshots
- `LeaderboardEntry`, `ProofCardData` — leaderboard and proof card data shapes
- `ApiEnvSchema`, `KeeperEnvSchema` — Zod env validation for api and keeper
- `ApiResponse<T>`, `ApiResult<T>` — generic HTTP response wrappers
- `bigintReplacer`, `bigintReviver` — JSON serialization helpers for bigint

## BigInt convention

All microALGO amounts, ASA IDs, app IDs, and round numbers are `bigint` in this package. API responses serialize them as decimal strings. Use `bigintReplacer` with `JSON.stringify` and `bigintReviver` with `JSON.parse` for round-trip serialization.

## Usage

```ts
import { BetSchema, GameIdSchema, bigintReplacer } from '@fairground/types';

const bet = BetSchema.parse(rawData);
const json = JSON.stringify(bet, bigintReplacer);
```
