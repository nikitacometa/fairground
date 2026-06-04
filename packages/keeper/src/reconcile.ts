/**
 * Chain reconciliation for the crash window between a confirmed resolve() and its DB write.
 *
 * resolve() moves money and deletes the flip box on-chain, then the keeper records the outcome in
 * Postgres. If the keeper dies in between (OOM, redeploy), or someone else calls the permissionless
 * resolve() first, the bet is stranded: the stale sweep re-queues it, the retry calls resolve()
 * again, and the contract reverts ("no active flip to resolve") because the box is already gone --
 * which would otherwise push the bet to 'failed' forever. Instead we rebuild the result from chain.
 */

import { createHash } from 'node:crypto';
import algosdk from 'algosdk';
import { db, sessions, bets } from '@fairground/db';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { computeNetPayout } from './payout.js';
import { extractBeaconOutputHex } from './vrf-extract.js';

function decodeUint64BE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Find the resolve() txn that already settled `player`'s flip for `commitRound`. Walks the player's
 * coinflip app-call history and requires BOTH that the top-level call is `resolve(player)` (the
 * wallet can appear in another player's resolve as a referrer, and many flips share a beacon round,
 * so the round alone is not enough) AND that the beacon inner-call targets `commitRound`. Returns
 * the txn id + captured VRF output, or null if none is found yet (indexer lag) or the shape is off.
 */
async function findResolveTxn(
  indexer: algosdk.Indexer,
  coinflipAppId: bigint,
  beaconAppId: bigint,
  player: string,
  commitRound: bigint,
): Promise<{ txnId: string; vrfOutput: string | null } | null> {
  const playerPk = algosdk.decodeAddress(player).publicKey;
  const res = await indexer
    .searchForTransactions()
    .address(player)
    .applicationID(coinflipAppId)
    .txType('appl')
    .limit(50)
    .do();
  const txns: algosdk.indexerModels.Transaction[] = res.transactions ?? [];
  for (const txn of txns) {
    // Top-level call must be resolve(player): args = [selector, player address (32 bytes)].
    const playerArg = txn.applicationTransaction?.applicationArgs?.[1];
    if (!playerArg || !bytesEqual(playerArg, playerPk)) continue;
    // ...and its beacon inner-call must target this flip's commit round.
    const inners = txn.innerTxns ?? [];
    const beaconInner = inners.find((i) => i.applicationTransaction?.applicationId === beaconAppId);
    const roundArg = beaconInner?.applicationTransaction?.applicationArgs?.[1];
    if (!roundArg || decodeUint64BE(roundArg) !== commitRound) continue;
    return { txnId: txn.id ?? '', vrfOutput: extractBeaconOutputHex(inners) };
  }
  return null;
}

/**
 * Reconcile a bet that was resolved on-chain but never recorded. Re-derives the outcome from the
 * on-chain VRF output (sha256(beacon || salt)[0] % 2) and writes bet + session atomically. Returns
 * the recovered { won, txnId } so the caller can publish the WS event, or null if the resolve txn
 * could not be located (caller falls through to a normal resolve / retries later).
 */
export async function reconcileResolvedBet(
  indexer: algosdk.Indexer,
  logger: Logger,
  coinflipAppId: bigint,
  beaconAppId: bigint,
  params: {
    betId: string;
    sessionId: string;
    player: string;
    commitRound: bigint;
    currentRound: bigint;
  },
): Promise<{ won: boolean; txnId: string } | null> {
  const found = await findResolveTxn(
    indexer,
    coinflipAppId,
    beaconAppId,
    params.player,
    params.commitRound,
  );
  if (!found || !found.vrfOutput) return null;

  const [bet] = await db
    .select({ amount: bets.amountMicroalgo, saltHash: bets.saltHash })
    .from(bets)
    .where(eq(bets.id, params.betId))
    .limit(1);
  if (!bet) return null;

  const digest = createHash('sha256')
    .update(Buffer.concat([Buffer.from(found.vrfOutput, 'hex'), Buffer.from(bet.saltHash, 'hex')]))
    .digest();
  const won = (digest[0] ?? 0) % 2 === 1;
  const netPayout = computeNetPayout(won, bet.amount);

  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ state: 'resolved', resolveRound: params.currentRound, updatedAt: new Date() })
      .where(eq(sessions.id, params.sessionId));
    await tx
      .update(bets)
      .set({
        outcome: won ? 'win' : 'loss',
        netPayoutMicroalgo: netPayout,
        vrfOutput: found.vrfOutput,
        proofCardUrl: `/proof/${found.txnId}`,
        resolveTxnId: found.txnId,
        resolvedAt: new Date(),
      })
      .where(eq(bets.id, params.betId));
  });

  logger.warn(
    { sessionId: params.sessionId, betId: params.betId, txnId: found.txnId, won },
    'reconciled an already-resolved flip from chain (resolved off-keeper or before a crash)',
  );
  return { won, txnId: found.txnId };
}
