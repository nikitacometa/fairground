import { bets, sessions, type Database } from '@fairground/db';
import type { GameId } from '@fairground/types';
import type { VerifiedFlipTransaction } from '@fairground/sdk';
import { and, desc, eq } from 'drizzle-orm';

export interface RegisterVerifiedBetInput extends VerifiedFlipTransaction {
  gameId: GameId;
  playerPick: 'heads' | 'tails' | null;
}

export interface RegisteredBet {
  betId: string;
  sessionId: string;
  vrfRound: bigint;
  amountMicroalgo: bigint;
  created: boolean;
}

export class BetChainIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BetChainIdentityConflictError';
  }
}

type BetRow = typeof bets.$inferSelect;

function matchesChainIdentity(row: BetRow, input: RegisterVerifiedBetInput): boolean {
  return (
    row.txnId === input.txnId &&
    row.walletAddress === input.walletAddress &&
    row.gameId === input.gameId &&
    row.amountMicroalgo === input.amountMicroalgo &&
    row.vrfRound === input.vrfRound &&
    row.saltHash.toLowerCase() === input.saltHash.toLowerCase() &&
    row.referrerWallet === input.referrerWallet
  );
}

function matchesSweptIdentity(row: BetRow, input: RegisterVerifiedBetInput): boolean {
  return (
    (row.txnId === null || row.txnId === input.txnId) &&
    row.walletAddress === input.walletAddress &&
    row.gameId === input.gameId &&
    row.amountMicroalgo === input.amountMicroalgo &&
    row.vrfRound === input.vrfRound &&
    row.saltHash.toLowerCase() === input.saltHash.toLowerCase() &&
    row.referrerWallet === input.referrerWallet
  );
}

/**
 * Persist a chain-verified flip and its keeper session atomically.
 * Both inserts use the schema's unique chain identities, so concurrent retries converge.
 */
export async function registerVerifiedBet(
  database: Database,
  input: RegisterVerifiedBetInput,
): Promise<RegisteredBet> {
  return database.transaction(async (tx) => {
    let created = false;
    let [bet] = await tx.select().from(bets).where(eq(bets.txnId, input.txnId)).limit(1);

    if (bet && !matchesChainIdentity(bet, input)) {
      throw new BetChainIdentityConflictError('txnId is already linked to different chain data');
    }

    if (!bet) {
      // The keeper may have discovered the same on-chain box before the client registered it.
      const [swept] = await tx
        .select()
        .from(bets)
        .where(and(eq(bets.walletAddress, input.walletAddress), eq(bets.vrfRound, input.vrfRound)))
        .orderBy(desc(bets.createdAt))
        .limit(1);

      if (swept) {
        if (!matchesSweptIdentity(swept, input)) {
          throw new BetChainIdentityConflictError(
            'wallet and commit round are linked to different chain data',
          );
        }
        [bet] = await tx
          .update(bets)
          .set({
            txnId: input.txnId,
          })
          .where(eq(bets.id, swept.id))
          .returning();
      }
    }

    if (!bet) {
      [bet] = await tx
        .insert(bets)
        .values({
          walletAddress: input.walletAddress,
          gameId: input.gameId,
          amountMicroalgo: input.amountMicroalgo,
          vrfRound: input.vrfRound,
          saltHash: input.saltHash,
          playerPick: input.playerPick,
          outcome: 'pending',
          txnId: input.txnId,
          referrerWallet: input.referrerWallet,
          // Matches the on-chain REFERRAL_BPS in coinflip/contract.py.
          referralRakeBps: input.referrerWallet ? 100 : null,
        })
        .onConflictDoNothing()
        .returning();
      created = bet !== undefined;

      // A concurrent request may have won the unique txn_id race.
      if (!bet) {
        [bet] = await tx.select().from(bets).where(eq(bets.txnId, input.txnId)).limit(1);
        if (bet && !matchesChainIdentity(bet, input)) {
          throw new BetChainIdentityConflictError(
            'concurrent txnId registration has different chain data',
          );
        }
      }
    }

    if (!bet) throw new Error('bet upsert returned no row');

    let [session] = await tx.select().from(sessions).where(eq(sessions.betId, bet.id)).limit(1);
    if (!session) {
      [session] = await tx
        .insert(sessions)
        .values({
          betId: bet.id,
          walletAddress: bet.walletAddress,
          gameId: bet.gameId,
          state: 'pending',
          commitRound: bet.vrfRound,
          appId: input.appId,
        })
        .onConflictDoNothing()
        .returning();
    }
    if (!session) {
      [session] = await tx
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.walletAddress, bet.walletAddress),
            eq(sessions.commitRound, bet.vrfRound),
          ),
        )
        .limit(1);
    }
    if (!session || session.betId !== bet.id) {
      throw new BetChainIdentityConflictError('session chain identity belongs to another bet');
    }

    return {
      betId: bet.id,
      sessionId: session.id,
      vrfRound: bet.vrfRound,
      amountMicroalgo: bet.amountMicroalgo,
      created,
    };
  });
}
