import { Hono } from 'hono';
import { db, bets, leaderboardSnapshots } from '@fairground/db';
import { desc, eq, sql } from 'drizzle-orm';
import { resolveNfds } from '@fairground/nfd';
import type { Logger } from 'pino';

export function makeLeaderboardRouter(logger: Logger): Hono {
  const app = new Hono();

  // GET /leaderboard?limit=50&offset=0 — snapshot-based view (retained for compatibility).
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

  // GET /leaderboard/live?limit=20 — computed directly from the bets table (no snapshot job
  // required), with NFD names resolved server-side for the top wallets. Ranked by net P&L.
  app.get('/live', async (c) => {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20', 10) || 20, 1), 100);

    // Net P&L = (net payout received on wins) − (stake on every resolved game). A win nets
    // payout − stake; a loss nets −stake. Summed across a wallet's resolved (win/loss) games.
    const netPnl = sql`
      coalesce(sum(${bets.netPayoutMicroalgo}) filter (where ${bets.outcome} = 'win'), 0)
      - coalesce(sum(${bets.amountMicroalgo}) filter (where ${bets.outcome} in ('win', 'loss')), 0)
    `;
    const resolvedGames = sql`count(*) filter (where ${bets.outcome} in ('win', 'loss'))`;

    try {
      const rows = await db
        .select({
          walletAddress: bets.walletAddress,
          games: resolvedGames.mapWith(Number),
          wins: sql`count(*) filter (where ${bets.outcome} = 'win')`.mapWith(Number),
          volumeMicroalgo:
            sql`coalesce(sum(${bets.amountMicroalgo}) filter (where ${bets.outcome} in ('win', 'loss')), 0)`.mapWith(
              String,
            ),
          netPnlMicroalgo: netPnl.mapWith(String),
        })
        .from(bets)
        .groupBy(bets.walletAddress)
        .having(sql`${resolvedGames} > 0`)
        .orderBy(desc(netPnl))
        .limit(limit);

      const nfds = await resolveNfds(rows.map((r) => r.walletAddress));

      return c.json({
        ok: true as const,
        data: rows.map((r, i) => ({
          rank: i + 1,
          walletAddress: r.walletAddress,
          walletNfd: nfds.get(r.walletAddress)?.name ?? null,
          games: r.games,
          wins: r.wins,
          winRate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0,
          volumeMicroalgo: r.volumeMicroalgo,
          netPnlMicroalgo: r.netPnlMicroalgo,
        })),
      });
    } catch (err) {
      logger.error({ err }, 'failed to compute live leaderboard');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  return app;
}
