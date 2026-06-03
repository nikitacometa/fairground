import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { resolveNfd } from '@fairground/nfd';

/** Reverse-resolve a bettor's NFD name with a short Redis cache. Empty string = no NFD. */
async function resolveWalletNfd(
  redis: Redis,
  logger: Logger,
  address: string,
): Promise<string | null> {
  const key = `nfd:${address}`;
  try {
    const cached = await redis.get(key);
    if (cached !== null) return cached || null; // '' is the cached "no NFD" sentinel
    const record = await resolveNfd(address);
    const name = record?.name ?? null;
    await redis.set(key, name ?? '', 'EX', 600); // 10-min TTL; cache misses too, to avoid hammering
    return name;
  } catch (err) {
    logger.warn({ err, address }, 'nfd resolve failed for proof card');
    return null;
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
      const walletNfd = await resolveWalletNfd(redis, logger, bet.walletAddress);

      // Generate proof card PNG
      // Dynamic import to avoid loading satori/sharp at startup
      const { generateProofCard } = await import('@fairground/proof-card');
      const png = await generateProofCard(
        {
          game: 'coinflip',
          walletPrefix: bet.walletAddress.slice(0, 8),
          walletNfd,
          outcome: bet.outcome === 'win' ? 'heads' : 'tails',
          multiplier: bet.outcome === 'win' ? 1.96 : 0,
          vrfRound: bet.vrfRound,
          beaconOutputHash: bet.vrfOutput ?? '0'.repeat(64),
          txnId,
          netPayoutMicroalgo: bet.netPayoutMicroalgo ?? 0n,
          timestamp: bet.resolvedAt ?? new Date(),
        },
        { referrerAddress: bet.walletAddress },
      );

      // Cache permanently -- proofs are immutable
      await redis.set(cacheKey, png);

      c.header('Content-Type', 'image/png');
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
      return c.body(new Uint8Array(png).buffer);
    } catch (err) {
      logger.error({ err, txnId }, 'failed to generate proof card');
      return c.json({ ok: false as const, error: 'internal_error', code: 'proof_error' }, 500);
    }
  });

  return app;
}
