import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { count, eq, max, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

// Off-chain jackpot v1: a display counter accumulating 1% of every resolved stake (the slice of the
// 3% house edge earmarked for the pot). The draw/payout mechanism ships later; for now it is the
// growing-number retention hook on the landing + game. Computed from resolved volume so there is no
// accumulator row to seed or race.
const JACKPOT_CONTRIBUTION_BPS = 100n;
const BPS_DENOMINATOR = 10_000n;

/**
 * GET /stats/live -- aggregate counters for the landing's LiveStats island and the game's jackpot
 * ticker. bigints are serialized as strings, matching the ApiResult<LiveStatsWire> envelope.
 */
export function makeStatsRouter(logger: Logger): Hono {
  const app = new Hono();

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

  return app;
}
