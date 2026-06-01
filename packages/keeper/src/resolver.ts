import algosdk from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { db, sessions, bets } from '@fairground/db';
import { CoinflipContractClient, createAlgorandClientFromEnv } from '@fairground/sdk';
import { eq, and, isNull, lte, lt } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

// Publish resolved events to Redis for WS fan-out
const CHANNEL_BET_RESOLVED = 'fairground:bet:resolved';

// Sessions stuck in 'resolving' for longer than this are re-queued for retry.
// A keeper crash mid-flight leaves sessions in this state indefinitely.
const RESOLVING_STALE_MS = 3 * 60 * 1000; // 3 minutes

// Settle buffer: resolve() requires Global.round >= commit_round + BEACON_SETTLE_BUFFER.
// Must match the constant in the coinflip Puya contract (currently 4).
const BEACON_SETTLE_BUFFER = 4n;

/**
 * Resolve all pending sessions whose commit_round + BEACON_SETTLE_BUFFER has passed.
 *
 * This is the core keeper loop action. Called every 4 seconds by the leader.
 *
 * Flow:
 *   1. Query sessions WHERE state='pending' AND commit_round + 4 <= current_round
 *   2. For each session: call CoinflipContract.resolve() via generated SDK client
 *   3. Update session state to 'resolved', update bet outcome + resolve_txn_id
 *   4. Publish event to Redis pub/sub for WS fan-out
 *
 * Recovery sweep (step 0):
 *   Sessions stuck in 'resolving' older than RESOLVING_STALE_MS are reset to 'pending'
 *   so the next tick can retry them. This handles keeper crashes mid-flight.
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
  treasuryAppId: bigint,
  beaconAppId: bigint,
  keeperMnemonic: string,
): Promise<void> {
  // Recovery sweep: re-queue sessions stuck in 'resolving' (keeper died mid-flight).
  const staleThreshold = new Date(Date.now() - RESOLVING_STALE_MS);
  const staleSessions = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.state, 'resolving'), lt(sessions.updatedAt, staleThreshold)));

  if (staleSessions.length > 0) {
    logger.warn(
      { count: staleSessions.length },
      'recovering stale resolving sessions -- keeper likely crashed mid-flight',
    );
    for (const { id } of staleSessions) {
      await db
        .update(sessions)
        .set({ state: 'pending', updatedAt: new Date() })
        .where(eq(sessions.id, id));
    }
  }

  const status = await algodClient.status().do();
  // algosdk v3 returns camelCase bigint fields (not 'last-round')
  const currentRound = status.lastRound;

  // Fetch sessions ready to resolve (commit_round + BEACON_SETTLE_BUFFER <= current_round)
  const pendingSessions = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.state, 'pending'),
        isNull(sessions.resolveRound),
        lte(sessions.commitRound, currentRound - BEACON_SETTLE_BUFFER),
      ),
    )
    .limit(20); // batch size -- process max 20 per tick

  if (pendingSessions.length === 0) return;

  logger.info({ count: pendingSessions.length, currentRound }, 'resolving sessions');

  // Build the keeper account and AlgorandClient once per batch.
  const account = algosdk.mnemonicToSecretKey(keeperMnemonic);
  const signer = algosdk.makeBasicAccountTransactionSigner(account);

  const algorand = createAlgorandClientFromEnv();
  // Register the signer so the client can sign transactions automatically.
  algorand.setDefaultSigner(signer);

  const coinflipClient = new CoinflipContractClient({
    algorand,
    appId: coinflipAppId,
    defaultSender: account.addr.toString(),
  });

  // Precompute the coinflip app address bytes for the treasury game-registry box key.
  // Treasury BoxMap key: b"game:" + coinflip_app_address (32 raw bytes).
  const coinflipAppAddrBytes = algosdk.getApplicationAddress(coinflipAppId).publicKey;
  const gameBoxKey = new Uint8Array([
    ...new TextEncoder().encode('game:'),
    ...coinflipAppAddrBytes,
  ]);

  for (const session of pendingSessions) {
    try {
      // Mark as 'resolving' before sending to prevent concurrent resolution.
      await db
        .update(sessions)
        .set({ state: 'resolving', updatedAt: new Date() })
        .where(eq(sessions.id, session.id));

      // Build the player's flip box key: b"flip:" + player_address (32 raw bytes).
      // Coinflip BoxMap key_prefix=b"flip:", so on-chain key = 5 + 32 = 37 bytes.
      const playerAddrBytes = algosdk.decodeAddress(session.walletAddress).publicKey;
      const flipBoxKey = new Uint8Array([...new TextEncoder().encode('flip:'), ...playerAddrBytes]);

      // resolve() requires:
      //   box refs: player's flip box (appId=0 = current contract) +
      //             treasury game-registry box (appId=treasuryAppId)
      //   app refs: [treasuryAppId, beaconAppId] (inner calls to both contracts)
      //   fee:      1 outer + 4 inner (beacon call, optional referral, sweep, payout/MBR)
      //             = 5 * 1000 microALGO minimum; extraFee covers the 4 inner txns
      const result = await coinflipClient.send.resolve({
        args: { player: session.walletAddress },
        boxReferences: [
          { appId: coinflipAppId, name: flipBoxKey },
          { appId: treasuryAppId, name: gameBoxKey },
        ],
        appReferences: [treasuryAppId, beaconAppId],
        extraFee: AlgoAmount.MicroAlgos(4000),
      });

      const won = result.return ?? false;
      const txnId = result.txIds[0] ?? '';

      logger.info(
        { sessionId: session.id, txnId, won, player: session.walletAddress },
        'session resolved',
      );

      // Update session to resolved.
      await db
        .update(sessions)
        .set({
          state: 'resolved',
          resolveRound: currentRound,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, session.id));

      // Update the linked bet record with the outcome and resolve txn ID.
      await db
        .update(bets)
        .set({
          outcome: won ? 'win' : 'loss',
          resolveTxnId: txnId,
          resolvedAt: new Date(),
        })
        .where(eq(bets.id, session.betId));

      // Publish to Redis pub/sub for WebSocket fan-out.
      await redis.publish(
        CHANNEL_BET_RESOLVED,
        JSON.stringify({
          sessionId: session.id,
          betId: session.betId,
          walletAddress: session.walletAddress,
          won,
          txnId,
          resolvedAt: new Date().toISOString(),
        }),
      );
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
