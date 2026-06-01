import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// All bigint columns use mode: 'bigint' for JS bigint.
// drizzle-orm 0.45.x: bigint() requires explicit mode.

export const bets = pgTable(
  'bets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAddress: text('wallet_address').notNull(),
    gameId: text('game_id').notNull(), // 'coinflip' | 'minefield'
    amountMicroalgo: bigint('amount_microalgo', { mode: 'bigint' }).notNull(),
    vrfRound: bigint('vrf_round', { mode: 'bigint' }).notNull(), // commit_round
    vrfOutput: text('vrf_output'), // hex-encoded 32 bytes
    saltHash: text('salt_hash').notNull(), // hex-encoded 32 bytes
    outcome: text('outcome').notNull().default('pending'), // BetOutcome enum
    multiplier: integer('multiplier'),
    netPayoutMicroalgo: bigint('net_payout_microalgo', { mode: 'bigint' }),
    referrerWallet: text('referrer_wallet'),
    referralRakeBps: integer('referral_rake_bps'),
    txnId: text('txn_id'), // flip() txn ID
    resolveTxnId: text('resolve_txn_id'),
    proofCardUrl: text('proof_card_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('bets_wallet_idx').on(t.walletAddress),
    index('bets_vrf_round_idx').on(t.vrfRound),
    index('bets_outcome_idx').on(t.outcome),
    // Prevent duplicate bet rows: each flip() txn id must appear at most once.
    // Partial (WHERE NOT NULL) because txnId is nullable until the txn is confirmed.
    uniqueIndex('bets_txn_id_unique')
      .on(t.txnId)
      .where(sql`${t.txnId} IS NOT NULL`),
    // Same for the resolve txn: one resolution record per resolve() txn.
    uniqueIndex('bets_resolve_txn_id_unique')
      .on(t.resolveTxnId)
      .where(sql`${t.resolveTxnId} IS NOT NULL`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id),
    walletAddress: text('wallet_address').notNull(),
    gameId: text('game_id').notNull(),
    state: text('state').notNull().default('pending'), // SessionState enum
    commitRound: bigint('commit_round', { mode: 'bigint' }).notNull(),
    resolveRound: bigint('resolve_round', { mode: 'bigint' }),
    retryCount: integer('retry_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sessions_state_idx').on(t.state),
    index('sessions_commit_round_idx').on(t.commitRound),
    index('sessions_wallet_idx').on(t.walletAddress),
    // On-chain idempotency key: a wallet has at most one active flip per commit round.
    // Mirrors beaconRound + walletAddress uniqueness enforced by the coinflip contract box.
    uniqueIndex('sessions_wallet_commit_round_unique').on(t.walletAddress, t.commitRound),
    // Index on the FK so the DB can efficiently look up sessions by bet.
    index('sessions_bet_id_idx').on(t.betId),
  ],
);

export const jackpot = pgTable('jackpot', {
  id: uuid('id').primaryKey().defaultRandom(),
  balanceMicroalgo: bigint('balance_microalgo', { mode: 'bigint' }).notNull().default(0n),
  contributionBps: integer('contribution_bps').notNull().default(0),
  winOddsOneIn: integer('win_odds_one_in').notNull().default(1000),
  lastTriggerAt: timestamp('last_trigger_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAddress: text('wallet_address').notNull(),
    wins: bigint('wins', { mode: 'bigint' }).notNull().default(0n),
    losses: bigint('losses', { mode: 'bigint' }).notNull().default(0n),
    totalVolumeMicroalgo: bigint('total_volume_microalgo', { mode: 'bigint' })
      .notNull()
      .default(0n),
    winsAmountMicroalgo: bigint('wins_amount_microalgo', { mode: 'bigint' }).notNull().default(0n),
    lossesAmountMicroalgo: bigint('losses_amount_microalgo', { mode: 'bigint' })
      .notNull()
      .default(0n),
    jackpotHits: bigint('jackpot_hits', { mode: 'bigint' }).notNull().default(0n),
    lastRound: bigint('last_round', { mode: 'bigint' }).notNull().default(0n),
    gamesPlayed: bigint('games_played', { mode: 'bigint' }).notNull().default(0n),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('lb_wallet_idx').on(t.walletAddress),
    index('lb_wins_idx').on(t.wins),
    index('lb_volume_idx').on(t.totalVolumeMicroalgo),
  ],
);
