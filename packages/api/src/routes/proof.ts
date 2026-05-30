import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { Logger } from 'pino';

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
        return c.body(cached);
      }

      // Look up bet by resolve txn ID
      const [bet] = await db
        .select()
        .from(bets)
        .where(eq(bets.resolveTxnId, txnId))
        .limit(1);

      if (!bet) {
        return c.json({ error: 'proof_not_found', message: 'No resolved bet for this txn ID' }, 404);
      }

      if (bet.outcome === 'pending') {
        return c.json({ error: 'not_resolved', message: 'Bet is not yet resolved' }, 202);
      }

      // A proof card only exists for a settled win or loss. A refunded bet
      // (keeper failed past the 48h window) has no VRF result to prove.
      if (bet.outcome !== 'win' && bet.outcome !== 'loss') {
        return c.json(
          { error: 'no_proof_for_outcome', message: `No proof card for outcome: ${bet.outcome}` },
          409,
        );
      }

      // Generate proof card PNG
      // Dynamic import to avoid loading satori/sharp at startup
      const { generateProofCard } = await import('@fairground/proof-card');
      const png = await generateProofCard({
        game: 'coinflip',
        walletPrefix: bet.walletAddress.slice(0, 8),
        outcome: bet.outcome === 'win' ? 'heads' : 'tails',
        multiplier: bet.outcome === 'win' ? 1.96 : 0,
        vrfRound: bet.vrfRound,
        beaconOutputHash: bet.vrfOutput ?? '0'.repeat(64),
        txnId,
        netPayoutMicroalgo: bet.netPayoutMicroalgo ?? 0n,
        timestamp: bet.resolvedAt ?? new Date(),
      });

      // Cache permanently -- proofs are immutable
      await redis.set(cacheKey, png);

      c.header('Content-Type', 'image/png');
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
      return c.body(png);
    } catch (err) {
      logger.error({ err, txnId }, 'failed to generate proof card');
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  return app;
}
