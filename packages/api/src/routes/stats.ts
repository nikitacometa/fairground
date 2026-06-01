import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { eq, count, max } from 'drizzle-orm';
import type { Logger } from 'pino';

/**
 * GET /stats/live -- aggregate counters for the landing page's LiveStats island.
 * jackpotMicroalgo is always 0 in v1 (no jackpot until v1.2). bigints are serialized
 * as strings, matching the ApiResult<LiveStatsWire> envelope the client parses.
 */
export function makeStatsRouter(logger: Logger): Hono {
  const app = new Hono();

  app.get('/live', async (c) => {
    try {
      const [totals] = await db.select({ totalFlips: count() }).from(bets);
      const [wins] = await db
        .select({ biggest: max(bets.netPayoutMicroalgo) })
        .from(bets)
        .where(eq(bets.outcome, 'win'));

      return c.json({
        ok: true as const,
        data: {
          totalFlips: (totals?.totalFlips ?? 0).toString(),
          biggestWinMicroalgo: (wins?.biggest ?? 0n).toString(),
          jackpotMicroalgo: '0',
        },
      });
    } catch (err) {
      logger.error({ err }, 'failed to load live stats');
      return c.json({ ok: false as const, error: 'internal_error', code: 'stats_error' }, 500);
    }
  });

  return app;
}
