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

// Per-wallet referral earnings, summed over every resolved flip that named this wallet as the
// on-chain referrer. The contract pays 1% of each stake to the referrer on resolve.
export const ReferralStatsSchema = z.object({
  address: z.string().min(58).max(58),
  referredCount: z.number().int().min(0),
  totalEarnedMicroalgo: z.bigint().min(0n),
  referredVolumeMicroalgo: z.bigint().min(0n),
});
export type ReferralStats = z.infer<typeof ReferralStatsSchema>;

export const ProofCardDataSchema = z.object({
  game: z.enum(['coinflip', 'minefield']),
  walletPrefix: z.string().max(12), // first 8 chars of wallet address, display only
  // Resolved NFD name (e.g. `goanna.algo`) shown in place of walletPrefix when the
  // bettor's address owns a forward-verified NFD. Null/absent → fall back to the prefix.
  walletNfd: z.string().max(64).nullish(),
  // Consecutive-win streak ending at this flip (0 on a loss). Drives the proof-card flair badge.
  streak: z.number().int().min(0).nullish(),
  // The side the player actually called. Drives the truthful "PICKED HEADS · WON" label.
  // Null/absent (pre-M1 bets) → the card shows just WON/LOST without a side.
  playerPick: z.enum(['heads', 'tails']).nullish(),
  outcome: z.enum(['heads', 'tails', 'jackpot']),
  multiplier: z.number().positive(),
  vrfRound: z.bigint().positive(),
  // Raw 32-byte VRF beacon output (hex). This is the value the derivation hashes with the
  // salt — anyone can look it up on the beacon for `vrfRound` and recompute the outcome.
  beaconOutput: z.string().length(64),
  txnId: z.string().min(52).max(52), // base64url Algorand txn ID
  netPayoutMicroalgo: z.bigint(),
  // The player's stake in microALGO. On a loss the card shows it as the amount lost
  // ("−X ALGO"); on a win the net payout carries the hero number. Optional for back-compat.
  stakeMicroalgo: z.bigint().min(0n).nullish(),
  timestamp: z.coerce.date(),
});
export type ProofCardData = z.infer<typeof ProofCardDataSchema>;
