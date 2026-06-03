import { z } from 'zod/v4';

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  walletAddress: z.string().min(58).max(58),
  wins: z.bigint().min(0n),
  losses: z.bigint().min(0n),
  totalVolumeMicroalgo: z.bigint().min(0n),
  winsAmountMicroalgo: z.bigint().min(0n),
  lossesAmountMicroalgo: z.bigint().min(0n),
  jackpotHits: z.bigint().min(0n),
  lastRound: z.bigint().min(0n),
  gamesPlayed: z.bigint().min(0n),
  // Computed off-chain: winsAmountMicroalgo - lossesAmountMicroalgo
  netPnlMicroalgo: z.bigint(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardSnapshotSchema = z.object({
  id: z.string().uuid(),
  snapshotAt: z.coerce.date(),
  entries: z.array(LeaderboardEntrySchema),
});
export type LeaderboardSnapshot = z.infer<typeof LeaderboardSnapshotSchema>;

export const ProofCardDataSchema = z.object({
  game: z.enum(['coinflip', 'minefield']),
  walletPrefix: z.string().max(12), // first 8 chars of wallet address, display only
  // Resolved NFD name (e.g. `goanna.algo`) shown in place of walletPrefix when the
  // bettor's address owns a forward-verified NFD. Null/absent → fall back to the prefix.
  walletNfd: z.string().max(64).nullish(),
  // Consecutive-win streak ending at this flip (0 on a loss). Drives the proof-card flair badge.
  streak: z.number().int().min(0).nullish(),
  outcome: z.enum(['heads', 'tails', 'jackpot']),
  multiplier: z.number().positive(),
  vrfRound: z.bigint().positive(),
  beaconOutputHash: z.string().length(64), // hex-encoded sha256 of raw beacon bytes
  txnId: z.string().min(52).max(52), // base64url Algorand txn ID
  netPayoutMicroalgo: z.bigint(),
  timestamp: z.coerce.date(),
});
export type ProofCardData = z.infer<typeof ProofCardDataSchema>;
