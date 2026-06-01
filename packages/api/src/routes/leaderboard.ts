import { Hono } from 'hono';
import { db } from '@fairground/db';
import { leaderboardSnapshots } from '@fairground/db';
import { desc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

export function makeLeaderboardRouter(logger: Logger): Hono {
  const app = new Hono();

  // GET /leaderboard?limit=50&offset=0
  app.get('/', async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    try {
      const rows = await db
        .select()
        .from(leaderboardSnapshots)
        .where(eq(leaderboardSnapshots.isActive, true))
        .orderBy(desc(leaderboardSnapshots.winsAmountMicroalgo))
        .limit(limit)
        .offset(offset);

      return c.json({
        ok: true as const,
        data: rows.map((row, i) => ({
          rank: offset + i + 1,
          walletAddress: row.walletAddress,
          wins: row.wins.toString(),
          losses: row.losses.toString(),
          totalVolumeMicroalgo: row.totalVolumeMicroalgo.toString(),
          winsAmountMicroalgo: row.winsAmountMicroalgo.toString(),
          lossesAmountMicroalgo: row.lossesAmountMicroalgo.toString(),
          netPnlMicroalgo: (row.winsAmountMicroalgo - row.lossesAmountMicroalgo).toString(),
          jackpotHits: row.jackpotHits.toString(),
          lastRound: row.lastRound.toString(),
          gamesPlayed: row.gamesPlayed.toString(),
        })),
      });
    } catch (err) {
      logger.error({ err }, 'failed to fetch leaderboard');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  return app;
}
