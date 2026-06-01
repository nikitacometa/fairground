import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod/v4';
import { db } from '@fairground/db';
import { bets, sessions } from '@fairground/db';
import { GameIdSchema } from '@fairground/types';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

export function makeBetsRouter(logger: Logger): Hono {
  const app = new Hono();

  // POST /games/:gameId/bets
  // Called by the frontend after flip() txn is confirmed on-chain.
  app.post(
    '/:gameId/bets',
    zValidator(
      'json',
      z.object({
        walletAddress: z.string().min(58).max(58),
        txnId: z.string(), // confirmed flip() txn ID
        vrfRound: z.string().transform((s) => BigInt(s)), // commit_round as string
        saltHash: z.string().length(64),
        amountMicroalgo: z.string().transform((s) => BigInt(s)),
        referrerWallet: z.string().nullable().optional(),
      }),
    ),
    async (c) => {
      const gameId = GameIdSchema.safeParse(c.req.param('gameId'));
      if (!gameId.success) {
        return c.json(
          { ok: false as const, error: 'invalid_game_id', code: 'validation_error' },
          400,
        );
      }

      const body = c.req.valid('json');

      try {
        const [bet] = await db
          .insert(bets)
          .values({
            walletAddress: body.walletAddress,
            gameId: gameId.data,
            amountMicroalgo: body.amountMicroalgo,
            vrfRound: body.vrfRound,
            saltHash: body.saltHash,
            outcome: 'pending',
            txnId: body.txnId,
            referrerWallet: body.referrerWallet ?? null,
            referralRakeBps: body.referrerWallet ? 25 : null,
          })
          .returning();

        if (!bet) {
          return c.json({ ok: false as const, error: 'insert_failed', code: 'db_error' }, 500);
        }

        await db.insert(sessions).values({
          betId: bet.id,
          walletAddress: body.walletAddress,
          gameId: gameId.data,
          state: 'pending',
          commitRound: body.vrfRound,
        });

        logger.info({ betId: bet.id, walletAddress: body.walletAddress }, 'bet registered');

        // Serialize bigint as string for JSON transport
        return c.json({
          ok: true as const,
          data: {
            betId: bet.id,
            vrfRound: bet.vrfRound.toString(),
            amountMicroalgo: bet.amountMicroalgo.toString(),
          },
        });
      } catch (err) {
        logger.error({ err }, 'failed to register bet');
        return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
      }
    },
  );

  // GET /games/:gameId/state/:sessionId
  app.get('/:gameId/state/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    try {
      const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

      if (!session) {
        return c.json({ ok: false as const, error: 'not_found', code: 'session_not_found' }, 404);
      }

      return c.json({
        ok: true as const,
        data: {
          id: session.id,
          state: session.state,
          commitRound: session.commitRound.toString(),
          resolveRound: session.resolveRound?.toString() ?? null,
          retryCount: session.retryCount,
          lastError: session.lastError,
          updatedAt: session.updatedAt.toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err, sessionId }, 'failed to fetch session state');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  return app;
}
