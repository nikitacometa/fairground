import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod/v4';
import { db } from '@fairground/db';
import { bets, sessions } from '@fairground/db';
import { GameIdSchema } from '@fairground/types';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { computeWinStreak } from '../lib/streak.js';

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
        playerPick: z.enum(['heads', 'tails']).optional(),
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
        // Idempotent: a retried recordBet, or a recovery-on-reload after a confirmed flip whose
        // first registration was lost, must return the EXISTING session (the on-chain flip happened
        // once) rather than fail on the unique txnId index. Look it up before inserting.
        const [existing] = await db.select().from(bets).where(eq(bets.txnId, body.txnId)).limit(1);
        if (existing) {
          let [existingSession] = await db
            .select({ id: sessions.id })
            .from(sessions)
            .where(eq(sessions.betId, existing.id))
            .limit(1);
          // Heal an orphan bet (a bet row with no session) by creating the missing session, so the
          // keeper can resolve the on-chain flip. Falling through to a fresh insert would just hit
          // the unique txnId index and 500 -- leaving the flip permanently unresolved.
          if (!existingSession) {
            [existingSession] = await db
              .insert(sessions)
              .values({
                betId: existing.id,
                walletAddress: existing.walletAddress,
                gameId: existing.gameId,
                state: 'pending',
                commitRound: existing.vrfRound,
              })
              .returning({ id: sessions.id });
          }
          if (existingSession) {
            return c.json({
              ok: true as const,
              data: {
                betId: existing.id,
                sessionId: existingSession.id,
                vrfRound: existing.vrfRound.toString(),
                amountMicroalgo: existing.amountMicroalgo.toString(),
              },
            });
          }
        }

        // New flip: insert bet + session atomically so a partial failure can't orphan a bet.
        const { bet, session } = await db.transaction(async (tx) => {
          const [b] = await tx
            .insert(bets)
            .values({
              walletAddress: body.walletAddress,
              gameId: gameId.data,
              amountMicroalgo: body.amountMicroalgo,
              vrfRound: body.vrfRound,
              saltHash: body.saltHash,
              playerPick: body.playerPick ?? null,
              outcome: 'pending',
              txnId: body.txnId,
              referrerWallet: body.referrerWallet ?? null,
              // Matches the on-chain REFERRAL_BPS in coinflip/contract.py (1% of the stake).
              referralRakeBps: body.referrerWallet ? 100 : null,
            })
            .returning();
          if (!b) throw new Error('bet insert returned no row');
          const [s] = await tx
            .insert(sessions)
            .values({
              betId: b.id,
              walletAddress: body.walletAddress,
              gameId: gameId.data,
              state: 'pending',
              commitRound: body.vrfRound,
            })
            .returning();
          if (!s) throw new Error('session insert returned no row');
          return { bet: b, session: s };
        });

        logger.info(
          { betId: bet.id, sessionId: session.id, walletAddress: body.walletAddress },
          'bet registered',
        );

        // Serialize bigint as string for JSON transport. sessionId is what the client
        // polls GET /games/:gameId/state/:sessionId with, so it must be returned here.
        return c.json({
          ok: true as const,
          data: {
            betId: bet.id,
            sessionId: session.id,
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
  // Session progress joined to the linked bet, so the client can render the outcome,
  // payout, and proof card once the keeper resolves the flip.
  app.get('/:gameId/state/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    try {
      const [row] = await db
        .select()
        .from(sessions)
        .innerJoin(bets, eq(sessions.betId, bets.id))
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!row) {
        return c.json({ ok: false as const, error: 'not_found', code: 'session_not_found' }, 404);
      }

      const { sessions: session, bets: bet } = row;

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
          // Bet outcome -- 'pending' until the keeper resolves; populated thereafter.
          outcome: bet.outcome,
          amountMicroalgo: bet.amountMicroalgo.toString(),
          netPayoutMicroalgo: bet.netPayoutMicroalgo?.toString() ?? null,
          proofCardUrl: bet.proofCardUrl,
          txnId: bet.resolveTxnId,
          vrfOutput: bet.vrfOutput,
        },
      });
    } catch (err) {
      logger.error({ err, sessionId }, 'failed to fetch session state');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  // GET /games/:gameId/streak/:address
  // The wallet's current live win streak, computed server-side from the bets table — the source of
  // truth, so the chip survives a reload, a cleared localStorage, or a different device.
  app.get('/:gameId/streak/:address', async (c) => {
    const gameId = GameIdSchema.safeParse(c.req.param('gameId'));
    if (!gameId.success) {
      return c.json(
        { ok: false as const, error: 'invalid_game_id', code: 'validation_error' },
        400,
      );
    }
    const address = c.req.param('address');
    if (address.length !== 58) {
      return c.json(
        { ok: false as const, error: 'invalid_address', code: 'validation_error' },
        400,
      );
    }
    try {
      const streak = await computeWinStreak(address, new Date(), gameId.data);
      return c.json({ ok: true as const, data: { streak } });
    } catch (err) {
      logger.error({ err, address }, 'failed to compute streak');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  return app;
}
