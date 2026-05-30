import { z } from 'zod/v4';

export const GameIdSchema = z.enum(['coinflip', 'minefield']);
export type GameId = z.infer<typeof GameIdSchema>;

export const BetOutcomeSchema = z.enum(['win', 'loss', 'pending', 'refunded']);
export type BetOutcome = z.infer<typeof BetOutcomeSchema>;

export const BetSchema = z.object({
  id: z.string().uuid(),
  walletAddress: z.string().min(58).max(58),
  gameId: GameIdSchema,
  amountMicroalgo: z.bigint().positive(),
  vrfRound: z.bigint().positive(),
  vrfOutput: z.string().nullable(),          // hex-encoded 32 bytes, null until resolved
  saltHash: z.string().length(64),           // hex-encoded 32-byte player commitment
  outcome: BetOutcomeSchema,
  multiplier: z.number().positive().nullable(),
  netPayoutMicroalgo: z.bigint().nullable(),
  referrerWallet: z.string().nullable(),
  referralRakeBps: z.number().int().min(0).max(10000).nullable(),
  txnId: z.string().nullable(),              // flip() txn ID
  resolveTxnId: z.string().nullable(),       // resolve() txn ID
  proofCardUrl: z.string().url().nullable(),
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable(),
});
export type Bet = z.infer<typeof BetSchema>;

// Wire type: bigint serialized as string for JSON transport
export const BetWireSchema = BetSchema.extend({
  amountMicroalgo: z.string(),
  vrfRound: z.string(),
  netPayoutMicroalgo: z.string().nullable(),
});
export type BetWire = z.infer<typeof BetWireSchema>;
