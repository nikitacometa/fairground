/**
 * Zod schemas and wire types for the FairJackpot Daily Pot feature.
 *
 * Wire convention: all bigint values are serialized as plain decimal strings (no "n" suffix).
 * Callers convert with BigInt() or z.coerce.bigint().
 */

import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Shared runner-up entry (used in both wire and proof-card schemas)
// ---------------------------------------------------------------------------

const RunnerUpWireSchema = z.object({
  address: z.string(),
  nfd: z.string().nullable(),
  payoutMicroalgo: z.string(), // bigint as decimal string
});

export type RunnerUpWire = z.infer<typeof RunnerUpWireSchema>;

// ---------------------------------------------------------------------------
// DrawWireSchema — shape of the `lastDraw` field in GET /jackpot and
// individual rows returned by GET /jackpot/draws.
// ---------------------------------------------------------------------------

export const DrawWireSchema = z.object({
  epochId: z.string(),
  potMicroalgo: z.string(),
  rolloverMicroalgo: z.string(),
  totalTickets: z.string(),
  vrfRound: z.string(),
  drawnAt: z.string().nullable(), // ISO-8601 or null when draw not yet resolved
  proofUrl: z.string().nullable(),
  winner: z
    .object({
      address: z.string(),
      nfd: z.string().nullable(),
      payoutMicroalgo: z.string(),
    })
    .nullable(),
  runnersUp: z.array(RunnerUpWireSchema),
});
export type DrawWire = z.infer<typeof DrawWireSchema>;

// ---------------------------------------------------------------------------
// JackpotStateWireSchema — full GET /jackpot response body (inside `data`).
// ---------------------------------------------------------------------------

export const JackpotStateWireSchema = z.object({
  potMicroalgo: z.string(),
  epochId: z.string(),
  nextDrawAt: z.string(), // ISO-8601 timestamp derived from epoch_close_ts
  totalTickets: z.string(),
  totalEntries: z.string(),
  rolloverMicroalgo: z.string(), // last_rollover from global state
  paused: z.boolean(),
  pendingDraw: z
    .object({
      epochId: z.string(),
      commitRound: z.string(),
      potMicroalgo: z.string(),
      totalTickets: z.string(),
    })
    .nullable(),
  params: z.object({
    jackpotBps: z.number(), // from coinflip global state
    winnerBps: z.number(),
    runnerBps: z.number(),
    runnerCount: z.number(),
    backstopMicroalgo: z.string(),
  }),
  lastDraw: DrawWireSchema.nullable(),
  // Present only when ?address=ALGOADDR was supplied to GET /jackpot.
  myTickets: z.string().optional(),
  myWageredThisEpoch: z.string().optional(),
});
export type JackpotStateWire = z.infer<typeof JackpotStateWireSchema>;

// ---------------------------------------------------------------------------
// DailyDrawCardDataSchema — input to the proof-card PNG generator for draws.
// Consumed by packages/proof-card and GET /proof/draw/:epochId.
// ---------------------------------------------------------------------------

export const DailyDrawCardDataSchema = z.object({
  epochId: z.coerce.bigint(),
  potMicroalgo: z.coerce.bigint(),
  rolloverMicroalgo: z.coerce.bigint(),
  winnerAddress: z.string(),
  winnerNfd: z.string().nullish(),
  winnerPayoutMicroalgo: z.coerce.bigint(),
  runnersUp: z.array(
    z.object({
      address: z.string(),
      nfd: z.string().nullish(),
      payoutMicroalgo: z.coerce.bigint(),
    }),
  ),
  totalTickets: z.coerce.bigint(),
  winnerTickets: z.coerce.bigint(),
  vrfRound: z.coerce.bigint(),
  beaconOutput: z.string().length(64), // hex-encoded 32 bytes
  timestamp: z.coerce.date(),
});
export type DailyDrawCardData = z.infer<typeof DailyDrawCardDataSchema>;

// ---------------------------------------------------------------------------
// Redis pub/sub channel + event type.
// Keeper publishes after a resolved draw; Hono WS fans out to connected clients.
// ---------------------------------------------------------------------------

export const REDIS_CHANNEL_DRAW_RESOLVED = 'fairground:draw:resolved' as const;

export type DrawResolvedEvent = {
  type: 'draw:resolved';
  epochId: string;
  potMicroalgo: string;
  winnerAddress: string;
  winnerPayoutMicroalgo: string;
  proofUrl: string;
};
