import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { desc, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { resolveNfds } from '@fairground/nfd';

/**
 * GET /feed?limit=50 — the public live feed of resolved flips, newest first.
 *
 * This is the social-proof surface: every row carries the resolve txn id (verify on any
 * explorer) and the proof-card link, so "provably fair" is something a visitor can click,
 * not a claim. Public, read-only, no auth. Cached 5s in Redis so a crowd polling the feed
 * page costs one DB query per 5 seconds, not one per viewer.
 */
export function makeFeedRouter(logger: Logger, redis: Redis): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100);
    const cacheKey = `feed:${limit}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        c.header('Cache-Control', 'public, max-age=5');
        return c.body(cached, 200, { 'Content-Type': 'application/json' });
      }

      const rows = await db
        .select({
          id: bets.id,
          walletAddress: bets.walletAddress,
          amountMicroalgo: bets.amountMicroalgo,
          playerPick: bets.playerPick,
          outcome: bets.outcome,
          netPayoutMicroalgo: bets.netPayoutMicroalgo,
          vrfRound: bets.vrfRound,
          resolveTxnId: bets.resolveTxnId,
          resolvedAt: bets.resolvedAt,
        })
        .from(bets)
        .where(sql`${bets.outcome} in ('win', 'loss')`)
        .orderBy(desc(bets.resolvedAt))
        .limit(limit);

      const nfds = await resolveNfds(rows.map((r) => r.walletAddress));

      const payload = JSON.stringify({
        ok: true as const,
        data: rows.map((r) => {
          const pick = r.playerPick === 'heads' || r.playerPick === 'tails' ? r.playerPick : null;
          // The side the coin actually landed on: the pick on a win, the opposite on a loss.
          const landed =
            pick === null
              ? null
              : r.outcome === 'win'
                ? pick
                : pick === 'heads'
                  ? 'tails'
                  : 'heads';
          return {
            id: r.id,
            walletAddress: r.walletAddress,
            walletNfd: nfds.get(r.walletAddress)?.name ?? null,
            betMicroalgo: r.amountMicroalgo.toString(),
            pick,
            landed,
            outcome: r.outcome as 'win' | 'loss',
            payoutMicroalgo: (r.netPayoutMicroalgo ?? 0n).toString(),
            vrfRound: r.vrfRound.toString(),
            txnId: r.resolveTxnId,
            proofUrl: r.resolveTxnId ? `/proof/${r.resolveTxnId}` : null,
            resolvedAt: r.resolvedAt?.toISOString() ?? null,
          };
        }),
      });

      await redis.set(cacheKey, payload, 'EX', 5);
      c.header('Cache-Control', 'public, max-age=5');
      return c.body(payload, 200, { 'Content-Type': 'application/json' });
    } catch (err) {
      logger.error({ err }, 'failed to load flip feed');
      return c.json({ ok: false as const, error: 'internal_error', code: 'feed_error' }, 500);
    }
  });

  return app;
}
