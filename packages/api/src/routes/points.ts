import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { desc, eq, sql } from 'drizzle-orm';
import { resolveNfds } from '@fairground/nfd';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { FLIP_POINTS } from '../lib/fairPoints.js';

/**
 * FAIR points — read side (docs/design/fair-points-v1.md).
 * Totals are aggregated from the bets table on every read: 100 per resolved (win/loss)
 * flip + banked tap points. Nothing is precomputed, so the published formula and the
 * numbers people see can never drift apart.
 */
export function makePointsRouter(logger: Logger, redis: Redis): Hono {
  const app = new Hono();

  // Resolved (win/loss) flips only: refunded/failed flips earn nothing — otherwise
  // bet→refund cycles would farm flip points without ever paying the house edge.
  const resolvedFlips = sql`count(*) filter (where ${bets.outcome} in ('win', 'loss'))`;
  const tapsSum = sql`coalesce(sum(${bets.taps}) filter (where ${bets.outcome} in ('win', 'loss')), 0)`;
  const tapPointsSum = sql`coalesce(sum(${bets.tapPoints}) filter (where ${bets.outcome} in ('win', 'loss')), 0)`;
  const totalPoints = sql`${resolvedFlips} * ${FLIP_POINTS} + ${tapPointsSum}`;

  // GET /points/leaderboard?limit=50 — ranked FAIR totals with NFD names. Redis-cached 30s.
  // Registered before /:address so the static segment wins the route match.
  app.get('/leaderboard', async (c) => {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100);
    const cacheKey = `points:leaderboard:${limit}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return c.body(cached, 200, { 'Content-Type': 'application/json' });
      }
    } catch (err) {
      logger.warn({ err }, 'points leaderboard cache read failed — computing fresh');
    }

    try {
      const rows = await db
        .select({
          walletAddress: bets.walletAddress,
          flips: resolvedFlips.mapWith(Number),
          taps: tapsSum.mapWith(Number),
          tapPoints: tapPointsSum.mapWith(Number),
          totalPoints: totalPoints.mapWith(Number),
        })
        .from(bets)
        .groupBy(bets.walletAddress)
        .having(sql`${resolvedFlips} > 0`)
        .orderBy(desc(totalPoints), desc(resolvedFlips))
        .limit(limit);

      const nfds = await resolveNfds(rows.map((r) => r.walletAddress));

      const payload = JSON.stringify({
        ok: true as const,
        data: rows.map((r, i) => ({
          rank: i + 1,
          walletAddress: r.walletAddress,
          walletNfd: nfds.get(r.walletAddress)?.name ?? null,
          flips: r.flips,
          flipPoints: r.flips * FLIP_POINTS,
          taps: r.taps,
          tapPoints: r.tapPoints,
          totalPoints: r.totalPoints,
        })),
      });
      try {
        await redis.set(cacheKey, payload, 'EX', 30);
      } catch (err) {
        logger.warn({ err }, 'points leaderboard cache write failed');
      }
      return c.body(payload, 200, { 'Content-Type': 'application/json' });
    } catch (err) {
      logger.error({ err }, 'failed to compute points leaderboard');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  // GET /points/:address — one wallet's FAIR totals + rank (1 = most points; null until
  // the wallet has at least one resolved flip).
  app.get('/:address', async (c) => {
    const address = c.req.param('address');
    if (address.length !== 58) {
      return c.json(
        { ok: false as const, error: 'invalid_address', code: 'validation_error' },
        400,
      );
    }
    try {
      const [mine] = await db
        .select({
          flips: resolvedFlips.mapWith(Number),
          taps: tapsSum.mapWith(Number),
          tapPoints: tapPointsSum.mapWith(Number),
        })
        .from(bets)
        .where(eq(bets.walletAddress, address))
        .groupBy(bets.walletAddress)
        .limit(1);

      const flips = mine?.flips ?? 0;
      const taps = mine?.taps ?? 0;
      const tapPts = mine?.tapPoints ?? 0;
      const total = flips * FLIP_POINTS + tapPts;

      let rank: number | null = null;
      if (flips > 0) {
        // Wallets strictly ahead + 1. Ties share a rank, which is fine for a chip display.
        const ahead = await db.execute<{ ahead: number }>(sql`
          select count(*)::int as ahead from (
            select ${totalPoints} as pts
            from ${bets}
            group by ${bets.walletAddress}
            having ${resolvedFlips} > 0
          ) t where t.pts > ${total}
        `);
        rank = (ahead.rows[0]?.ahead ?? 0) + 1;
      }

      return c.json({
        ok: true as const,
        data: {
          flips,
          flipPoints: flips * FLIP_POINTS,
          taps,
          tapPoints: tapPts,
          totalPoints: total,
          rank,
        },
      });
    } catch (err) {
      logger.error({ err, address }, 'failed to fetch points');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  return app;
}
