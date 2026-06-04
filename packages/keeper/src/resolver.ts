import { createHash } from 'node:crypto';
import algosdk from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { db, sessions, bets } from '@fairground/db';
import { CoinflipContractClient, createAlgorandClientFromEnv } from '@fairground/sdk';
import { eq, and, isNull, lte, lt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { computeNetPayout } from './payout.js';
import { extractBeaconOutputHex } from './vrf-extract.js';
import { reconcileResolvedBet } from './reconcile.js';

// Publish resolved events to Redis for WS fan-out
const CHANNEL_BET_RESOLVED = 'fairground:bet:resolved';

// Sessions stuck in 'resolving' for longer than this are re-queued for retry.
// A keeper crash mid-flight leaves sessions in this state indefinitely.
const RESOLVING_STALE_MS = 3 * 60 * 1000; // 3 minutes

// Settle buffer: resolve() requires Global.round >= commit_round + BEACON_SETTLE_BUFFER.
// Must match the constant in the coinflip Puya contract (currently 4).
const BEACON_SETTLE_BUFFER = 4n;

// The Applied Blockchain beacon retains ~189 outputs = 1512 rounds (~70 min). Past that the VRF
// round is evicted and must_get() panics forever -- resolve() can never succeed, so the player
// must refund at 48h. Stop trying with a margin below the 1512-round hard edge.
const BEACON_RETENTION_ROUNDS = 1400n;

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
      // Increment retryCount on recovery: it bounds the retry loop AND flags the session as
      // "previously attempted" so the next tick reconciles it from chain before re-resolving.
      await db
        .update(sessions)
        .set({
          state: 'pending',
          retryCount: sql`${sessions.retryCount} + 1`,
          updatedAt: new Date(),
        })
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
  const indexer = algorand.client.indexer;

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
      // H-3 reconcile: a suspect session may already be resolved on-chain -- a prior attempt
      // confirmed resolve() but crashed before recording, OR the permissionless resolve() was
      // called off-keeper (by the player or anyone). Reconcile from chain before retrying or
      // expiring: a fresh resolve() would just revert ("no active flip") and march to 'failed', and
      // an aged-out flip must not be marked beacon_expired if it was actually settled. (The Puya
      // assert message is not in the runtime error, so the revert can't be detected post-hoc; the
      // indexer is the authoritative source of "did a resolve already happen".)
      const expiredByRound = currentRound - session.commitRound > BEACON_RETENTION_ROUNDS;
      if (session.retryCount > 0 || expiredByRound) {
        const reconciled = await reconcileResolvedBet(indexer, logger, coinflipAppId, beaconAppId, {
          betId: session.betId,
          sessionId: session.id,
          player: session.walletAddress,
          commitRound: session.commitRound,
          currentRound,
        });
        if (reconciled) {
          await redis.publish(
            CHANNEL_BET_RESOLVED,
            JSON.stringify({
              sessionId: session.id,
              betId: session.betId,
              walletAddress: session.walletAddress,
              won: reconciled.won,
              txnId: reconciled.txnId,
              resolvedAt: new Date().toISOString(),
            }),
          );
          continue;
        }
      }

      // H-4: the committed VRF round has aged past the beacon's retention window and no resolve
      // exists on-chain -- resolve() would panic on must_get() forever. Mark beacon_expired so the
      // bet surfaces as refundable (the player reclaims funds via the 48h refund path).
      if (expiredByRound) {
        logger.warn(
          { sessionId: session.id, commitRound: session.commitRound, currentRound },
          'VRF beacon round evicted before resolve -- marking beacon_expired (player must refund at 48h)',
        );
        await db
          .update(sessions)
          .set({
            state: 'beacon_expired',
            lastError: 'VRF beacon round evicted (~70 min) before resolve',
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, session.id));
        continue;
      }

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
      //   fee:      worst case 1 outer + 6 inner txns (beacon must_get, referral, sweep,
      //             pay_winner app-call + its inner payout, MBR refund) = 7 * 1000 microALGO.
      //             extraFee 7000 + the outer min fee 1000 = 8000 pooled covers it.
      const result = await coinflipClient.send.resolve({
        args: { player: session.walletAddress },
        boxReferences: [
          { appId: coinflipAppId, name: flipBoxKey },
          { appId: treasuryAppId, name: gameBoxKey },
        ],
        appReferences: [treasuryAppId, beaconAppId],
        extraFee: AlgoAmount.MicroAlgos(7000),
      });

      const won = result.return ?? false;
      const txnId = result.txIds[0] ?? '';

      // Capture the VRF beacon output from the resolve()'s inner must_get() return log so the
      // proof card can show the real 32-byte hash instead of 64 zeros. Null if the group shape
      // is unexpected -- the card then falls back to zeros (no regression).
      const vrfOutput = extractBeaconOutputHex(result.confirmation?.innerTxns);

      const [betRow] = await db
        .select({ amount: bets.amountMicroalgo, saltHash: bets.saltHash })
        .from(bets)
        .where(eq(bets.id, session.betId))
        .limit(1);
      const netPayout = betRow ? computeNetPayout(won, betRow.amount) : 0n;

      // Provably-fair self-check: the captured beacon output, hashed with the player's salt,
      // must reproduce the on-chain win/loss (sha256(beacon || salt)[0] % 2). On a mismatch the
      // capture is suspect, so drop it -- a proof card is cached permanently and must never
      // show an output that does not derive the outcome.
      let verifiedVrfOutput = vrfOutput;
      if (vrfOutput && betRow?.saltHash) {
        const digest = createHash('sha256')
          .update(
            Buffer.concat([Buffer.from(vrfOutput, 'hex'), Buffer.from(betRow.saltHash, 'hex')]),
          )
          .digest();
        if (((digest[0] ?? 0) % 2 === 1) !== won) {
          logger.warn(
            { sessionId: session.id, txnId, won },
            'beacon-derived outcome does not match resolve() return -- dropping suspect vrfOutput',
          );
          verifiedVrfOutput = null;
        }
      } else if (!vrfOutput) {
        logger.warn(
          { sessionId: session.id, txnId },
          'could not capture VRF beacon output from resolve confirmation',
        );
      }

      logger.info(
        { sessionId: session.id, txnId, won, netPayout, player: session.walletAddress },
        'session resolved',
      );

      // H-3: record the outcome atomically. The on-chain resolve() already moved money; if the
      // session and bet updates were separate, a crash between them would leave the bet stuck
      // 'pending' (or the session resolved without an outcome). One transaction -- both or neither.
      await db.transaction(async (tx) => {
        await tx
          .update(sessions)
          .set({ state: 'resolved', resolveRound: currentRound, updatedAt: new Date() })
          .where(eq(sessions.id, session.id));
        await tx
          .update(bets)
          .set({
            outcome: won ? 'win' : 'loss',
            netPayoutMicroalgo: netPayout,
            vrfOutput: verifiedVrfOutput,
            proofCardUrl: `/proof/${txnId}`,
            resolveTxnId: txnId,
            resolvedAt: new Date(),
          })
          .where(eq(bets.id, session.betId));
      });

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
