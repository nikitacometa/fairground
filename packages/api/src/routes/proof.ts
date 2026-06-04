import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { lookupNfd } from '@fairground/nfd';

/**
 * Count consecutive wins ending at (and including) the given resolved bet — the streak the
 * proof-card flair badge celebrates. A loss returns 0. Walks the wallet's resolved flips back
 * from this bet's resolution time.
 */
async function computeWinStreak(walletAddress: string, resolvedAt: Date | null): Promise<number> {
  if (!resolvedAt) return 0;
  const recent = await db
    .select({ outcome: bets.outcome })
    .from(bets)
    .where(
      and(
        eq(bets.walletAddress, walletAddress),
        isNotNull(bets.resolvedAt),
        lte(bets.resolvedAt, resolvedAt),
      ),
    )
    .orderBy(desc(bets.resolvedAt))
    .limit(50);
  let streak = 0;
  for (const row of recent) {
    if (row.outcome === 'win') streak += 1;
    else break;
  }
  return streak;
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

      // Resolve the bettor's NFD name (cached) so the card shows `goanna.algo`
      // instead of a raw prefix when they own a verified name.
      const nfd = await resolveWalletNfd(redis, logger, bet.walletAddress);

      // Win-streak ending at this flip — drives the proof-card flair badge.
      const streak =
        bet.outcome === 'win' ? await computeWinStreak(bet.walletAddress, bet.resolvedAt) : 0;

      // Generate proof card PNG
      // Dynamic import to avoid loading satori/sharp at startup
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
          timestamp: bet.resolvedAt ?? new Date(),
        },
        { referrerAddress: bet.walletAddress },
      );

      // The VRF result is immutable, but the NFD name is only baked in once. Cache the PNG
      // permanently ONLY when the NFD state was certain (a real name or a real "no NFD").
      // On a transient lookup failure, serve the (nameless) card but don't freeze it — let
      // the next request retry and pick up the name once nf.domains recovers.
      c.header('Content-Type', 'image/png');
      if (nfd.certain) {
        await redis.set(cacheKey, png);
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        c.header('Cache-Control', 'public, max-age=60');
      }
      return c.body(new Uint8Array(png).buffer);
    } catch (err) {
      logger.error({ err, txnId }, 'failed to generate proof card');
      return c.json({ ok: false as const, error: 'internal_error', code: 'proof_error' }, 500);
    }
  });

  return app;
}
