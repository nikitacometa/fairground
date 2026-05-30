import algosdk from 'algosdk';
import { db, sessions, bets } from '@fairground/db';
import { isBeaconRoundSettled } from '@fairground/sdk';
import { eq, and, isNull, lte } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { Logger } from 'pino';

// Publish resolved events to Redis for WS fan-out
const CHANNEL_BET_RESOLVED = 'fairground:bet:resolved';

/**
 * Resolve all pending sessions whose commit_round + 2 has passed.
 *
 * This is the core keeper loop action. Called every 4 seconds by the leader.
 *
 * Flow:
 *   1. Query sessions WHERE state='pending' AND commit_round <= current_round - 2
 *   2. For each session: call CoinflipContract.resolve() via generated SDK client
 *   3. Update session state to 'resolved', update bet outcome + resolve_txn_id
 *   4. Publish event to Redis pub/sub for WS fan-out
 *
 * Keeper SLA: all sessions must be resolved within 60 minutes of commit_round passing.
 * The Applied Blockchain beacon stores only the last 189 outputs (~70 min).
 * After 70 min, must_get() will panic -- the session becomes unresolvable.
 * At that point: trigger the 48h refund path instead.
 */
export async function resolveExpiredSessions(
  algodClient: algosdk.Algodv2,
  redis: Redis,
  logger: Logger,
  coinflipAppId: bigint,
  keeperMnemonic: string,
): Promise<void> {
  const status = await algodClient.status().do();
  const currentRound = BigInt(status['last-round'] as number);

  // Fetch sessions ready to resolve (commit_round + 2 <= current_round)
  const pendingSessions = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.state, 'pending'),
        isNull(sessions.resolveRound),
        lte(sessions.commitRound, currentRound - 2n),
      ),
    )
    .limit(20);  // batch size -- process max 20 per tick

  if (pendingSessions.length === 0) return;

  logger.info({ count: pendingSessions.length, currentRound }, 'resolving sessions');

  const account = algosdk.mnemonicToSecretKey(keeperMnemonic);

  for (const session of pendingSessions) {
    try {
      // Mark as 'resolving' before sending to prevent concurrent resolution
      await db
        .update(sessions)
        .set({ state: 'resolving', updatedAt: new Date() })
        .where(eq(sessions.id, session.id));

      // TODO: call CoinflipContract.resolve(player_address) via generated SDK client
      // The generated client doesn't exist yet (algokit generate client not run).
      // When client is generated:
      //   const client = new CoinflipContractClient({ id: coinflipAppId, algod: algodClient });
      //   const result = await client.resolve({ player: session.walletAddress }, { signer: account });
      //   const won = result.returnValue;
      //   const txnId = result.txID;

      // Placeholder: mark resolved with unknown outcome (replace with real call above)
      logger.warn({ sessionId: session.id }, 'resolve() not implemented -- awaiting generated client');

      await db
        .update(sessions)
        .set({
          state: 'failed',
          lastError: 'generated SDK client not yet available -- run algokit generate client',
          retryCount: session.retryCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, session.id));
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'failed to resolve session');
      await db
        .update(sessions)
        .set({
          state: session.retryCount >= 5 ? 'failed' : 'pending',
          retryCount: session.retryCount + 1,
          lastError: err instanceof Error ? err.message : String(err),
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, session.id));
    }
  }
}
