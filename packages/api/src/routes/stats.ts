import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { count, eq, max, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { CONTRACTS } from '@fairground/types';
import { env } from '../env.js';

// Off-chain jackpot v1: a display counter accumulating 1% of every resolved stake (the slice of the
// 3% house edge earmarked for the pot). The draw/payout mechanism ships later; for now it is the
// growing-number retention hook on the landing + game. Computed from resolved volume so there is no
// accumulator row to seed or race.
const JACKPOT_CONTRIBUTION_BPS = 100n;
const BPS_DENOMINATOR = 10_000n;

// Mirrors the constants compiled into coinflip/contract.py (HOUSE_EDGE_BPS / REFERRAL_BPS).
// These are immutable per deployed app version — bump together with CONTRACTS.coinflip.version.
const HOUSE_EDGE_BPS = 300;
const REFERRAL_BPS = 100;
const PAYOUT_MULTIPLIER = 1.94;

/**
 * On-chain coinflip config, read straight from the contract's global state so /stats is the
 * source of truth for copy (max bet changes via an admin call, not a redeploy — env vars and
 * hardcoded marketing numbers go stale; the chain doesn't).
 */
interface OnchainConfig {
  paused: boolean;
  minBetMicroalgo: string;
  maxBetMicroalgo: string;
  totalBetsOnchain: string;
  totalVolumeOnchainMicroalgo: string;
}

interface AlgodGlobalStateEntry {
  key: string;
  value: { type: number; uint?: number | string; bytes?: string };
}

async function fetchOnchainConfig(logger: Logger): Promise<OnchainConfig | null> {
  try {
    const headers: Record<string, string> = env.ALGOD_TOKEN
      ? { 'X-Algo-API-Token': env.ALGOD_TOKEN }
      : {};
    const res = await fetch(`${env.ALGOD_URL}/v2/applications/${env.COINFLIP_APP_ID}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'algod application lookup failed for /stats');
      return null;
    }
    const body = (await res.json()) as {
      params?: { 'global-state'?: AlgodGlobalStateEntry[] };
    };
    const entries = body.params?.['global-state'] ?? [];
    const state = new Map<string, bigint>();
    for (const e of entries) {
      const key = Buffer.from(e.key, 'base64').toString('utf8');
      if (e.value.type === 2) state.set(key, BigInt(e.value.uint ?? 0));
    }
    return {
      paused: (state.get('paused') ?? 0n) === 1n,
      minBetMicroalgo: (state.get('min_bet') ?? 0n).toString(),
      maxBetMicroalgo: (state.get('max_bet') ?? 0n).toString(),
      totalBetsOnchain: (state.get('total_bets') ?? 0n).toString(),
      totalVolumeOnchainMicroalgo: (state.get('total_volume') ?? 0n).toString(),
    };
  } catch (err) {
    logger.warn({ err }, 'failed to read on-chain coinflip config for /stats');
    return null;
  }
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

      const [totals] = await db
        .select({
          totalFlips: sql`count(*) filter (where ${RESOLVED})`.mapWith(Number),
          pendingFlips: sql`count(*) filter (where ${bets.outcome} = 'pending')`.mapWith(Number),
          volume: sql`coalesce(sum(${bets.amountMicroalgo}) filter (where ${RESOLVED}), 0)`.mapWith(
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
        .from(bets);

      const onchain = await fetchOnchainConfig(logger);

      const volume = BigInt(totals?.volume ?? '0');
      const winsPayout = BigInt(totals?.winsPayout ?? '0');
      // House P&L: every resolved stake is swept to the treasury; winners are paid net_payout
      // back out of it. (Referral rake is ignored here — product metric, not accounting.)
      const housePnl = volume - winsPayout;
      const jackpotSeed = (volume * JACKPOT_CONTRIBUTION_BPS) / BPS_DENOMINATOR;

      const payload = JSON.stringify({
        ok: true as const,
        data: {
          contract: {
            appId: CONTRACTS.coinflip.appId.toString(),
            treasuryAppId: CONTRACTS.houseTreasury.appId.toString(),
            vrfBeaconAppId: env.VRF_BEACON_APP_ID.toString(),
            network: env.ALGORAND_NETWORK,
            houseEdgeBps: HOUSE_EDGE_BPS,
            payoutMultiplier: PAYOUT_MULTIPLIER,
            referralBps: REFERRAL_BPS,
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
            jackpotSeedMicroalgo: jackpotSeed.toString(),
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
      const [totals] = await db
        .select({
          totalFlips: count(),
          resolvedVolume:
            sql`coalesce(sum(${bets.amountMicroalgo}) filter (where ${bets.outcome} in ('win', 'loss')), 0)`.mapWith(
              String,
            ),
        })
        .from(bets);
      const [wins] = await db
        .select({ biggest: max(bets.netPayoutMicroalgo) })
        .from(bets)
        .where(eq(bets.outcome, 'win'));

      const resolvedVolume = BigInt(totals?.resolvedVolume ?? '0');
      const jackpot = (resolvedVolume * JACKPOT_CONTRIBUTION_BPS) / BPS_DENOMINATOR;

      return c.json({
        ok: true as const,
        data: {
          totalFlips: (totals?.totalFlips ?? 0).toString(),
          biggestWinMicroalgo: (wins?.biggest ?? 0n).toString(),
          jackpotMicroalgo: jackpot.toString(),
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
