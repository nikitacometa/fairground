import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { count, eq, max, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { CONTRACTS } from '@fairground/types';
import { env } from '../env.js';
import { fetchCoinflipConfig, fetchJackpotState } from '../onchain.js';

// ---------------------------------------------------------------------------
// Static fallbacks (v1 contract values; superseded by chain state on v2+)
// ---------------------------------------------------------------------------
const FALLBACK_HOUSE_EDGE_BPS = 300;
const FALLBACK_REFERRAL_BPS = 100;
const BPS_DENOMINATOR = 10_000n;

/** Compute payout multiplier: (2 × (10000 − edge)) / 10000, rounded to 2 dp. */
function payoutMultiplier(edgeBps: number): number {
  return Math.round((2 * (10000 - edgeBps)) / 100) / 100;
}

/** The side the coin actually landed on: the player's pick on a win, the opposite on a loss. */
const LANDED_HEADS = sql`(${bets.outcome} = 'win' and ${bets.playerPick} = 'heads') or (${bets.outcome} = 'loss' and ${bets.playerPick} = 'tails')`;
const LANDED_TAILS = sql`(${bets.outcome} = 'win' and ${bets.playerPick} = 'tails') or (${bets.outcome} = 'loss' and ${bets.playerPick} = 'heads')`;
const RESOLVED = sql`${bets.outcome} in ('win', 'loss')`;

/**
 * Stats routes.
 *
 *   GET /stats        — full public product snapshot (on-chain config + aggregates). Cached 30s.
 *   GET /stats/live   — small counter set for the landing island + jackpot ticker (legacy shape).
 *   GET /stats/timeseries?window=24h|7d — flips/volume per bucket for trend charts. Cached 60s.
 *
 * All public, read-only, no auth. bigints serialize as strings.
 */
export function makeStatsRouter(logger: Logger, redis: Redis): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const cacheKey = 'stats:full';
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        c.header('Cache-Control', 'public, max-age=30');
        return c.body(cached, 200, { 'Content-Type': 'application/json' });
      }

      const [[totals], onchain, jackpotState] = await Promise.all([
        db
          .select({
            totalFlips: sql`count(*) filter (where ${RESOLVED})`.mapWith(Number),
            pendingFlips: sql`count(*) filter (where ${bets.outcome} = 'pending')`.mapWith(Number),
            volume:
              sql`coalesce(sum(${bets.amountMicroalgo}) filter (where ${RESOLVED}), 0)`.mapWith(
                String,
              ),
            uniquePlayers:
              sql`count(distinct ${bets.walletAddress}) filter (where ${RESOLVED})`.mapWith(Number),
            headsCount: sql`count(*) filter (where ${LANDED_HEADS})`.mapWith(Number),
            tailsCount: sql`count(*) filter (where ${LANDED_TAILS})`.mapWith(Number),
            winsPayout:
              sql`coalesce(sum(${bets.netPayoutMicroalgo}) filter (where ${bets.outcome} = 'win'), 0)`.mapWith(
                String,
              ),
            biggestWin:
              sql`coalesce(max(${bets.netPayoutMicroalgo}) filter (where ${bets.outcome} = 'win'), 0)`.mapWith(
                String,
              ),
            lastFlipAt: max(bets.resolvedAt),
            flips24h:
              sql`count(*) filter (where ${RESOLVED} and ${bets.resolvedAt} > now() - interval '24 hours')`.mapWith(
                Number,
              ),
            volume24h:
              sql`coalesce(sum(${bets.amountMicroalgo}) filter (where ${RESOLVED} and ${bets.resolvedAt} > now() - interval '24 hours'), 0)`.mapWith(
                String,
              ),
            players24h:
              sql`count(distinct ${bets.walletAddress}) filter (where ${RESOLVED} and ${bets.resolvedAt} > now() - interval '24 hours')`.mapWith(
                Number,
              ),
          })
          .from(bets),
        fetchCoinflipConfig(redis, logger),
        fetchJackpotState(redis, logger),
      ]);

      // Edge/referral/jackpot bps from chain state; fall back to static v1 values.
      const edgeBps =
        onchain?.houseEdgeBps !== undefined
          ? Number(onchain.houseEdgeBps)
          : FALLBACK_HOUSE_EDGE_BPS;
      const referralBps =
        onchain?.referralBps !== undefined ? Number(onchain.referralBps) : FALLBACK_REFERRAL_BPS;
      const jackpotBps = onchain?.jackpotBps !== undefined ? Number(onchain.jackpotBps) : null;

      const volume = BigInt(totals?.volume ?? '0');
      const winsPayout = BigInt(totals?.winsPayout ?? '0');
      const housePnl = volume - winsPayout;

      // jackpotSeedMicroalgo: real pot balance when jackpot app is configured, else legacy 1% derivation.
      const jackpotContributionBps = jackpotBps !== null ? BigInt(jackpotBps) : 100n;
      const jackpotSeed =
        jackpotState !== null
          ? jackpotState.potBalance
          : (volume * jackpotContributionBps) / BPS_DENOMINATOR;

      const jackpotField =
        jackpotState !== null
          ? {
              potMicroalgo: jackpotState.potBalance.toString(),
              nextDrawAt: new Date(Number(jackpotState.epochCloseTs) * 1000).toISOString(),
              epochId: jackpotState.epochId.toString(),
            }
          : null;

      const payload = JSON.stringify({
        ok: true as const,
        data: {
          contract: {
            appId: CONTRACTS.coinflip.appId.toString(),
            treasuryAppId: CONTRACTS.houseTreasury.appId.toString(),
            vrfBeaconAppId: env.VRF_BEACON_APP_ID.toString(),
            network: env.ALGORAND_NETWORK,
            houseEdgeBps: edgeBps,
            payoutMultiplier: payoutMultiplier(edgeBps),
            referralBps,
            jackpotBps,
            jackpotAppId: env.JACKPOT_APP_ID.toString(),
            // Live on-chain values (null when algod is unreachable — aggregates still serve).
            paused: onchain?.paused ?? null,
            minBetMicroalgo: onchain?.minBetMicroalgo ?? null,
            maxBetMicroalgo: onchain?.maxBetMicroalgo ?? null,
            totalBetsOnchain: onchain?.totalBetsOnchain ?? null,
            totalVolumeOnchainMicroalgo: onchain?.totalVolumeOnchainMicroalgo ?? null,
          },
          product: {
            totalFlips: totals?.totalFlips ?? 0,
            pendingFlips: totals?.pendingFlips ?? 0,
            totalVolumeMicroalgo: totals?.volume ?? '0',
            uniquePlayers: totals?.uniquePlayers ?? 0,
            headsCount: totals?.headsCount ?? 0,
            tailsCount: totals?.tailsCount ?? 0,
            housePnlMicroalgo: housePnl.toString(),
            biggestWinMicroalgo: totals?.biggestWin ?? '0',
            // Legacy field — kept for back-compat; contains real pot balance when configured.
            jackpotSeedMicroalgo: jackpotSeed.toString(),
            jackpot: jackpotField,
            flips24h: totals?.flips24h ?? 0,
            volume24hMicroalgo: totals?.volume24h ?? '0',
            players24h: totals?.players24h ?? 0,
            lastFlipAt: totals?.lastFlipAt?.toISOString() ?? null,
          },
          updatedAt: new Date().toISOString(),
        },
      });

      await redis.set(cacheKey, payload, 'EX', 30);
      c.header('Cache-Control', 'public, max-age=30');
      return c.body(payload, 200, { 'Content-Type': 'application/json' });
    } catch (err) {
      logger.error({ err }, 'failed to load full stats');
      return c.json({ ok: false as const, error: 'internal_error', code: 'stats_error' }, 500);
    }
  });

  app.get('/live', async (c) => {
    try {
      const [[totals], [wins], jackpotState] = await Promise.all([
        db
          .select({
            totalFlips: count(),
            resolvedVolume:
              sql`coalesce(sum(${bets.amountMicroalgo}) filter (where ${bets.outcome} in ('win', 'loss')), 0)`.mapWith(
                String,
              ),
          })
          .from(bets),
        db
          .select({ biggest: max(bets.netPayoutMicroalgo) })
          .from(bets)
          .where(eq(bets.outcome, 'win')),
        fetchJackpotState(redis, logger),
      ]);

      const resolvedVolume = BigInt(totals?.resolvedVolume ?? '0');
      // Use real pot balance if jackpot app is configured, else 1% legacy derivation.
      const jackpotMicroalgo =
        jackpotState !== null ? jackpotState.potBalance : (resolvedVolume * 100n) / 10_000n;

      return c.json({
        ok: true as const,
        data: {
          totalFlips: (totals?.totalFlips ?? 0).toString(),
          biggestWinMicroalgo: (wins?.biggest ?? 0n).toString(),
          jackpotMicroalgo: jackpotMicroalgo.toString(),
        },
      });
    } catch (err) {
      logger.error({ err }, 'failed to load live stats');
      return c.json({ ok: false as const, error: 'internal_error', code: 'stats_error' }, 500);
    }
  });

  app.get('/timeseries', async (c) => {
    const window = c.req.query('window') === '7d' ? '7d' : '24h';
    const cacheKey = `stats:timeseries:${window}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        c.header('Cache-Control', 'public, max-age=60');
        return c.body(cached, 200, { 'Content-Type': 'application/json' });
      }

      // 24h window buckets by hour, 7d window by day. Buckets with zero flips are simply
      // absent — chart consumers fill gaps client-side.
      const bucket = window === '7d' ? 'day' : 'hour';
      const interval = window === '7d' ? '7 days' : '24 hours';
      const rows = await db
        .select({
          // node-postgres returns date_trunc as a string for computed columns — normalize to ISO.
          bucket: sql`date_trunc('${sql.raw(bucket)}', ${bets.resolvedAt})`.mapWith((v: unknown) =>
            new Date(String(v)).toISOString(),
          ),
          flips: sql`count(*)`.mapWith(Number),
          wins: sql`count(*) filter (where ${bets.outcome} = 'win')`.mapWith(Number),
          volumeMicroalgo: sql`coalesce(sum(${bets.amountMicroalgo}), 0)`.mapWith(String),
        })
        .from(bets)
        .where(sql`${RESOLVED} and ${bets.resolvedAt} > now() - interval '${sql.raw(interval)}'`)
        .groupBy(sql`1`)
        .orderBy(sql`1`);

      const payload = JSON.stringify({
        ok: true as const,
        data: { window, bucket, points: rows },
      });
      await redis.set(cacheKey, payload, 'EX', 60);
      c.header('Cache-Control', 'public, max-age=60');
      return c.body(payload, 200, { 'Content-Type': 'application/json' });
    } catch (err) {
      logger.error({ err }, 'failed to load stats timeseries');
      return c.json({ ok: false as const, error: 'internal_error', code: 'stats_error' }, 500);
    }
  });

  return app;
}
