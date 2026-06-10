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
  jsonb,
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
    playerPick: text('player_pick'), // 'heads' | 'tails' — the side the player called (nullable: pre-M1 rows)
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
    // Referral stats: GET /referrals/:address filters by referrer + resolved outcome.
    index('bets_referrer_outcome_idx').on(t.referrerWallet, t.outcome),
    // Win-streak walk: filter by wallet, order by resolved_at desc (hot on every connect).
    index('bets_wallet_resolved_idx').on(t.walletAddress, t.resolvedAt),
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
    // Coinflip v2 app id. Null = legacy pre-v2 row (bet was placed against the old app).
    appId: bigint('app_id', { mode: 'bigint' }),
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
    index('sessions_app_id_idx').on(t.appId),
  ],
);

export const jackpot = pgTable('jackpot', {
  id: uuid('id').primaryKey().defaultRandom(),
  balanceMicroalgo: bigint('balance_microalgo', { mode: 'bigint' })
    .notNull()
    .default(sql`0`),
  contributionBps: integer('contribution_bps').notNull().default(0),
  winOddsOneIn: integer('win_odds_one_in').notNull().default(1000),
  lastTriggerAt: timestamp('last_trigger_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Daily-pot draw history. One row per epoch. State machine: committed → resolved → recorded.
// `recorded` = keeper has written the draw_tickets snapshot and published the WS event.
export const draws = pgTable(
  'draws',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    epochId: bigint('epoch_id', { mode: 'bigint' }).notNull(),
    state: text('state').notNull().default('committed'), // committed | resolved | recorded
    potMicroalgo: bigint('pot_microalgo', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    rolloverMicroalgo: bigint('rollover_microalgo', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    totalTickets: bigint('total_tickets', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    totalEntries: bigint('total_entries', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    commitRound: bigint('commit_round', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    vrfRound: bigint('vrf_round', { mode: 'bigint' }),
    beaconOutput: text('beacon_output'), // hex-encoded 32-byte VRF output
    winnerAddress: text('winner_address'),
    winnerNfd: text('winner_nfd'),
    winnerPayoutMicroalgo: bigint('winner_payout_microalgo', { mode: 'bigint' }),
    // Array of { address, nfd, payoutMicroalgo } — runner-up slots in slot order.
    runnersUp: jsonb('runners_up'),
    commitTxnId: text('commit_txn_id'),
    resolveTxnId: text('resolve_txn_id'),
    proofCardUrl: text('proof_card_url'),
    drawnAt: timestamp('drawn_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Each epoch has exactly one draw row.
    uniqueIndex('draws_epoch_id_unique').on(t.epochId),
    // One DB row per on-chain resolve() txn (partial — null until resolved).
    uniqueIndex('draws_resolve_txn_id_unique')
      .on(t.resolveTxnId)
      .where(sql`${t.resolveTxnId} IS NOT NULL`),
    index('draws_drawn_at_idx').on(t.drawnAt),
  ],
);

// Per-player ticket snapshot taken from on-chain boxes after each resolved draw.
// Keeper writes these before cleanup() to preserve the ticket ledger permanently.
export const drawTickets = pgTable(
  'draw_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    drawId: uuid('draw_id')
      .notNull()
      .references(() => draws.id),
    epochId: bigint('epoch_id', { mode: 'bigint' }).notNull(),
    walletAddress: text('wallet_address').notNull(),
    tickets: bigint('tickets', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    wageredMicroalgo: bigint('wagered_microalgo', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Upsert guard: a wallet appears at most once per epoch in the snapshot.
    uniqueIndex('draw_tickets_epoch_wallet_unique').on(t.epochId, t.walletAddress),
    index('draw_tickets_epoch_idx').on(t.epochId),
  ],
);

export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAddress: text('wallet_address').notNull(),
    wins: bigint('wins', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    losses: bigint('losses', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    totalVolumeMicroalgo: bigint('total_volume_microalgo', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    winsAmountMicroalgo: bigint('wins_amount_microalgo', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    lossesAmountMicroalgo: bigint('losses_amount_microalgo', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    jackpotHits: bigint('jackpot_hits', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    lastRound: bigint('last_round', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    gamesPlayed: bigint('games_played', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('lb_wallet_idx').on(t.walletAddress),
    index('lb_wins_idx').on(t.wins),
    index('lb_volume_idx').on(t.totalVolumeMicroalgo),
  ],
);
