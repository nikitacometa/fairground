import { Hono } from 'hono';
import { db, bets, draws, drawTickets } from '@fairground/db';
import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { lookupNfd } from '@fairground/nfd';
import { computeWinStreak } from '../lib/streak.js';

import type { DailyDrawCardData } from '@fairground/types';

/** Parse runners_up JSONB for the draw proof card. */
function parseDrawRunnersUp(raw: unknown): DailyDrawCardData['runnersUp'] {
  if (!Array.isArray(raw)) return [];
  const result: DailyDrawCardData['runnersUp'] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r['address'] !== 'string') continue;
    result.push({
      address: r['address'],
      nfd: typeof r['nfd'] === 'string' ? r['nfd'] : null,
      payoutMicroalgo: BigInt(
        typeof r['payoutMicroalgo'] === 'string' ? r['payoutMicroalgo'] : '0',
      ),
    });
  }
  return result;
}

/**
 * Reverse-resolve a bettor's NFD name with a short Redis cache.
 *
 * `certain` is false only when the lookup transiently failed (nf.domains outage / 429 /
 * network). The caller must NOT bake an uncertain result into the permanent proof-card
 * cache, or a temporary outage would freeze a nameless card forever. Confirmed results
 * (a real name or a real "no NFD") are cached for 10 min under `nfd:<addr>`; empty string
 * is the "no NFD" sentinel.
 */
async function resolveWalletNfd(
  redis: Redis,
  logger: Logger,
  address: string,
): Promise<{ name: string | null; certain: boolean }> {
  const key = `nfd:${address}`;
  try {
    const cached = await redis.get(key);
    if (cached !== null) return { name: cached || null, certain: true };
    const lookup = await lookupNfd(address);
    if (lookup.status === 'error') return { name: null, certain: false };
    const name = lookup.status === 'resolved' ? lookup.record.name : null;
    await redis.set(key, name ?? '', 'EX', 600);
    return { name, certain: true };
  } catch (err) {
    logger.warn({ err, address }, 'nfd resolve failed for proof card');
    return { name: null, certain: false };
  }
}

export function makeProofRouter(logger: Logger, redis: Redis): Hono {
  const app = new Hono();

  // Coalesce concurrent renders of the same proof card. A viral/shared link fans out into a burst
  // of simultaneous cache misses; without this, each would start its own ~1s satori+resvg render.
  // Keyed by txnId; the first request renders and warms Redis, the rest await the same Promise.
  const inflight = new Map<string, Promise<{ png: Buffer; certain: boolean }>>();

  // GET /proof/draw/:epochId — Daily Pot draw proof card PNG.
  // Registered BEFORE /:txnId so the literal "draw" segment wins over the catch-all.
  app.get('/draw/:epochId', async (c) => {
    const epochId = c.req.param('epochId');
    // Reject malformed ids before BigInt() throws (a scanner hitting /proof/draw/abc
    // should get a 400, not a logged 500).
    if (!/^\d+$/.test(epochId)) {
      return c.json({ ok: false as const, error: 'invalid_epoch_id', code: 'bad_request' }, 400);
    }
    const cacheKey = `proof:draw:${epochId}`;
    try {
      const cached = await redis.getBuffer(cacheKey);
      if (cached) {
        c.header('Content-Type', 'image/png');
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
        return c.body(new Uint8Array(cached).buffer);
      }

      // Look up draw row by epochId.
      const epochIdBigint = BigInt(epochId);
      const [draw] = await db.select().from(draws).where(eq(draws.epochId, epochIdBigint)).limit(1);

      if (!draw) {
        return c.json({ ok: false as const, error: 'draw_not_found', code: 'not_found' }, 404);
      }
      if (!draw.winnerAddress) {
        // Draw committed but not yet resolved — no proof to show.
        return c.json({ ok: false as const, error: 'draw_not_resolved', code: 'pending' }, 202);
      }

      // The winner's exact ticket count is the keeper's draw_tickets snapshot for that
      // wallet+epoch (the fairness claim on the card depends on it being real, not 0).
      const [winnerTicketRow] = await db
        .select({ tickets: drawTickets.tickets })
        .from(drawTickets)
        .where(
          and(
            eq(drawTickets.epochId, draw.epochId),
            eq(drawTickets.walletAddress, draw.winnerAddress),
          ),
        )
        .limit(1);

      // Re-resolve the winner NFD live: a card baked while nf.domains was down would
      // otherwise show a nameless winner forever. Prefer the stored snapshot, fall back
      // to a live lookup, and only cache permanently when the result is certain.
      const nfd = draw.winnerNfd
        ? { name: draw.winnerNfd, certain: true }
        : await resolveWalletNfd(redis, logger, draw.winnerAddress);

      const { generateDailyDrawCard } = await import('@fairground/proof-card');
      const png = await generateDailyDrawCard({
        epochId: draw.epochId,
        potMicroalgo: draw.potMicroalgo,
        rolloverMicroalgo: draw.rolloverMicroalgo,
        winnerAddress: draw.winnerAddress,
        winnerNfd: nfd.name,
        winnerPayoutMicroalgo: draw.winnerPayoutMicroalgo ?? 0n,
        runnersUp: parseDrawRunnersUp(draw.runnersUp),
        totalTickets: draw.totalTickets,
        winnerTickets: winnerTicketRow?.tickets ?? 0n,
        vrfRound: draw.vrfRound ?? 0n,
        beaconOutput: draw.beaconOutput ?? '0'.repeat(64),
        timestamp: draw.drawnAt ?? new Date(),
      });

      // Cache permanently only once the draw is recorded AND the winner NFD is settled,
      // mirroring the flip-card discipline (never bake an uncertain name forever).
      const permanent = draw.state === 'recorded' && nfd.certain;
      if (permanent) {
        await redis.set(cacheKey, png);
      }
      c.header('Content-Type', 'image/png');
      c.header(
        'Cache-Control',
        permanent ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      );
      return c.body(new Uint8Array(png).buffer);
    } catch (err) {
      logger.error({ err, epochId }, 'failed to generate daily draw proof card');
      return c.json({ ok: false as const, error: 'internal_error', code: 'proof_error' }, 500);
    }
  });

  // GET /proof/:txnId/meta
  // Lightweight JSON metadata for a resolved bet — feeds the proof permalink page's
  // OG/Twitter-card title ("won 18.0 ALGO — verified on-chain") and its on-page CTA.
  // No PNG generation; a single indexed DB read. Registered before /:txnId so the
  // two-segment path wins over the catch-all single segment.
  app.get('/:txnId/meta', async (c) => {
    const txnId = c.req.param('txnId');
    try {
      const [bet] = await db.select().from(bets).where(eq(bets.resolveTxnId, txnId)).limit(1);

      if (!bet) {
        return c.json({ ok: false as const, error: 'proof_not_found', code: 'not_found' }, 404);
      }
      if (bet.outcome === 'pending') {
        return c.json({ ok: false as const, error: 'not_resolved', code: 'pending' }, 202);
      }
      if (bet.outcome !== 'win' && bet.outcome !== 'loss') {
        return c.json(
          { ok: false as const, error: 'no_proof_for_outcome', code: 'invalid_outcome' },
          409,
        );
      }

      const nfd = await resolveWalletNfd(redis, logger, bet.walletAddress);

      // Short CDN cache: the result is immutable except for a late-arriving NFD name, so
      // a few minutes of staleness is harmless and keeps Twitter's crawler off the DB.
      c.header('Cache-Control', 'public, max-age=300');
      return c.json({
        ok: true as const,
        data: {
          txnId,
          outcome: bet.outcome,
          playerPick:
            bet.playerPick === 'heads' || bet.playerPick === 'tails' ? bet.playerPick : null,
          multiplier: bet.outcome === 'win' ? 1.94 : 0,
          netPayoutMicroalgo: (bet.netPayoutMicroalgo ?? 0n).toString(),
          vrfRound: bet.vrfRound.toString(),
          walletAddress: bet.walletAddress,
          walletPrefix: bet.walletAddress.slice(0, 8),
          walletNfd: nfd.name,
          resolvedAt: (bet.resolvedAt ?? new Date()).toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err, txnId }, 'failed to load proof meta');
      return c.json({ ok: false as const, error: 'internal_error', code: 'proof_error' }, 500);
    }
  });

  // GET /proof/:txnId
  // Returns the VRF proof card PNG for a resolved bet. Cached permanently in Redis.
  app.get('/:txnId', async (c) => {
    const txnId = c.req.param('txnId');
    const cacheKey = `proof:${txnId}`;

    try {
      // Check Redis cache first
      const cached = await redis.getBuffer(cacheKey);
      if (cached) {
        c.header('Content-Type', 'image/png');
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
        // Hono c.body accepts ArrayBuffer (not Node Buffer); copy to an exact-size ArrayBuffer.
        return c.body(new Uint8Array(cached).buffer);
      }

      // Look up bet by resolve txn ID
      const [bet] = await db.select().from(bets).where(eq(bets.resolveTxnId, txnId)).limit(1);

      if (!bet) {
        return c.json({ ok: false as const, error: 'proof_not_found', code: 'not_found' }, 404);
      }

      if (bet.outcome === 'pending') {
        return c.json({ ok: false as const, error: 'not_resolved', code: 'pending' }, 202);
      }

      // A proof card only exists for a settled win or loss. A refunded bet
      // (keeper failed past the 48h window) has no VRF result to prove.
      if (bet.outcome !== 'win' && bet.outcome !== 'loss') {
        return c.json(
          {
            ok: false as const,
            error: `no_proof_for_outcome`,
            code: 'invalid_outcome',
          },
          409,
        );
      }

      // Render once per txnId even under a concurrent burst (see `inflight` above). The job resolves
      // the NFD name, computes the streak, renders the PNG, and warms the Redis cache; later waiters
      // for the same card share this Promise instead of each kicking off their own render.
      let job = inflight.get(txnId);
      if (!job) {
        job = (async () => {
          // Resolve the bettor's NFD name (cached) so the card shows `goanna.algo`
          // instead of a raw prefix when they own a verified name.
          const nfd = await resolveWalletNfd(redis, logger, bet.walletAddress);

          // Win-streak ending at this flip — drives the proof-card flair badge.
          const streak =
            bet.outcome === 'win'
              ? await computeWinStreak(bet.walletAddress, bet.resolvedAt, bet.gameId)
              : 0;

          // Generate proof card PNG. Dynamic import to avoid loading satori/sharp at startup.
          const { generateProofCard } = await import('@fairground/proof-card');
          const png = await generateProofCard(
            {
              game: 'coinflip',
              walletPrefix: bet.walletAddress.slice(0, 8),
              walletNfd: nfd.name,
              streak,
              // The side the player actually called (null on pre-M1 bets). Drives the truthful
              // "PICKED HEADS · WON" label; `outcome` below stays the win/loss carrier.
              playerPick:
                bet.playerPick === 'heads' || bet.playerPick === 'tails' ? bet.playerPick : null,
              outcome: bet.outcome === 'win' ? 'heads' : 'tails',
              multiplier: bet.outcome === 'win' ? 1.94 : 0,
              vrfRound: bet.vrfRound,
              beaconOutput: bet.vrfOutput ?? '0'.repeat(64),
              txnId,
              netPayoutMicroalgo: bet.netPayoutMicroalgo ?? 0n,
              stakeMicroalgo: bet.amountMicroalgo,
              timestamp: bet.resolvedAt ?? new Date(),
            },
            { referrerAddress: bet.walletAddress },
          );

          // The VRF result is immutable, but the NFD name is only baked in once. Cache the PNG
          // permanently ONLY when the NFD state was certain (a real name or a real "no NFD"). On a
          // transient lookup failure, serve the (nameless) card but don't freeze it — let the next
          // request retry and pick up the name once nf.domains recovers.
          if (nfd.certain) await redis.set(cacheKey, png);
          return { png, certain: nfd.certain };
        })();
        inflight.set(txnId, job);
        // Release the slot once done (success or failure) so a later miss can re-render if needed.
        void job.finally(() => inflight.delete(txnId));
      }

      const { png, certain } = await job;
      c.header('Content-Type', 'image/png');
      c.header(
        'Cache-Control',
        certain ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      );
      return c.body(new Uint8Array(png).buffer);
    } catch (err) {
      logger.error({ err, txnId }, 'failed to generate proof card');
      return c.json({ ok: false as const, error: 'internal_error', code: 'proof_error' }, 500);
    }
  });

  return app;
}
