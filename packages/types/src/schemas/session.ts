import { z } from 'zod/v4';
import { GameIdSchema } from './bet.js';

export const SessionStateSchema = z.enum([
  'pending',    // flip() submitted, waiting for commit round to pass
  'resolving',  // keeper picked it up, resolve() tx in flight
  'resolved',   // outcome determined, payout settled
  'refunded',   // player triggered refund after 48h window
  'failed',     // keeper failed to resolve (retry loop active)
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  betId: z.string().uuid(),
  walletAddress: z.string().min(58).max(58),
  gameId: GameIdSchema,
  state: SessionStateSchema,
  commitRound: z.bigint().positive(),   // round the flip committed to (current + 8)
  resolveRound: z.bigint().nullable(),  // actual round in which resolve() was sent
  retryCount: z.number().int().min(0),
  lastError: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Session = z.infer<typeof SessionSchema>;

export const TreasuryStateSchema = z.object({
  appId: z.bigint(),
  balanceMicroalgo: z.bigint(),
  spendableMicroalgo: z.bigint(),       // balance - min_balance
  maxPayoutBps: z.number().int(),
  maxSinglePayoutMicroalgo: z.bigint(), // spendable * maxPayoutBps / 10000
  isPaused: z.boolean(),
  totalDeposited: z.bigint(),
  totalPaidOut: z.bigint(),
  fetchedAt: z.coerce.date(),
});
export type TreasuryState = z.infer<typeof TreasuryStateSchema>;

export const JackpotStateSchema = z.object({
  enabled: z.boolean(),
  balanceMicroalgo: z.bigint(),
  contributionBps: z.number().int(),
  winOddsOneIn: z.number().int(),
});
export type JackpotState = z.infer<typeof JackpotStateSchema>;
