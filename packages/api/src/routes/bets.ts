import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod/v4';
import { db } from '@fairground/db';
import { bets, sessions } from '@fairground/db';
import { GameIdSchema } from '@fairground/types';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { computeWinStreak } from '../lib/streak.js';
import {
  TAP_CAP,
  TAP_GRACE_MS,
  TAP_RATE_PER_SEC,
  goldenIndex,
  saltProofValid,
  tapPoints,
} from '../lib/fairPoints.js';
import { env } from '../env.js';

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
                appId: env.COINFLIP_APP_ID,
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

        // The keeper's orphan box-sweep may have registered this flip before the client could
        // (connectivity lost after signing). Same wallet + commit round = the same on-chain
        // flip (the contract allows one box per wallet per commit), so ADOPT the client's
        // txnId/pick into the swept row instead of colliding with the unique session index.
        const [swept] = await db
          .select()
          .from(bets)
          .where(and(eq(bets.walletAddress, body.walletAddress), eq(bets.vrfRound, body.vrfRound)))
          .orderBy(desc(bets.createdAt))
          .limit(1);
        if (swept) {
          await db
            .update(bets)
            .set({
              // Never overwrite a real txnId — differing non-null ids would mean a forged body.
              txnId: swept.txnId ?? body.txnId,
              playerPick: swept.playerPick ?? body.playerPick ?? null,
              referrerWallet: swept.referrerWallet ?? body.referrerWallet ?? null,
            })
            .where(eq(bets.id, swept.id));
          let [sweptSession] = await db
            .select({ id: sessions.id })
            .from(sessions)
            .where(eq(sessions.betId, swept.id))
            .limit(1);
          // A swept bet without a session (interrupted insert) gets the same healing as the
          // txnId path above — falling through would create a second bet for the same flip.
          if (!sweptSession) {
            [sweptSession] = await db
              .insert(sessions)
              .values({
                betId: swept.id,
                walletAddress: swept.walletAddress,
                gameId: swept.gameId,
                state: 'pending',
                commitRound: swept.vrfRound,
                appId: env.COINFLIP_APP_ID,
              })
              .returning({ id: sessions.id });
          }
          if (sweptSession) {
            logger.info(
              { betId: swept.id, sessionId: sweptSession.id, txnId: body.txnId },
              'recordBet adopted a sweep-registered flip',
            );
            return c.json({
              ok: true as const,
              data: {
                betId: swept.id,
                sessionId: sweptSession.id,
                vrfRound: swept.vrfRound.toString(),
                amountMicroalgo: swept.amountMicroalgo.toString(),
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
              appId: env.COINFLIP_APP_ID,
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

  // GET /games/:gameId/active/:address
  // The wallet's most recent flip, so a reload / different device / closed-tab can re-attach to a
  // flip in progress (or surface a result that resolved while the player was away) WITHOUT relying
  // on localStorage. The keeper-tracked session is the source of truth.
  //   status 'active'  — a pending/resolving flip the UI should resume polling
  //   status 'recent'  — resolved within the last 10 min, not necessarily seen yet → show the result
  //   status 'none'    — nothing to recover
  app.get('/:gameId/active/:address', async (c) => {
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
      const [row] = await db
        .select()
        .from(sessions)
        .innerJoin(bets, eq(sessions.betId, bets.id))
        .where(and(eq(sessions.walletAddress, address), eq(sessions.gameId, gameId.data)))
        .orderBy(desc(sessions.createdAt))
        .limit(1);

      if (!row) {
        return c.json({ ok: true as const, data: { status: 'none' as const } });
      }

      const { sessions: session, bets: bet } = row;
      const resolved = bet.outcome === 'win' || bet.outcome === 'loss';
      const RECENT_MS = 10 * 60 * 1000;
      const recent =
        resolved && bet.resolvedAt !== null && Date.now() - bet.resolvedAt.getTime() < RECENT_MS;

      // pending/resolving (not a terminal 'failed') → resume; recently resolved → show result.
      const status =
        !resolved && session.state !== 'failed' ? 'active' : recent ? 'recent' : 'none';

      return c.json({
        ok: true as const,
        data: {
          status,
          sessionId: session.id,
          state: session.state,
          commitRound: session.commitRound.toString(),
          playerPick: bet.playerPick,
          amountMicroalgo: bet.amountMicroalgo.toString(),
          outcome: bet.outcome,
          netPayoutMicroalgo: bet.netPayoutMicroalgo?.toString() ?? null,
          proofCardUrl: bet.proofCardUrl,
          txnId: bet.resolveTxnId,
          resolvedAt: bet.resolvedAt?.toISOString() ?? null,
        },
      });
    } catch (err) {
      logger.error({ err, address }, 'failed to fetch active flip');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  // POST /games/:gameId/taps/:sessionId
  // FAIR points clicker (docs/design/fair-points-v1.md). The client reports the ABSOLUTE tap
  // count for its own flip's seal wait; the server keeps max(stored, accepted) — idempotent,
  // monotonic, retry/multi-tab safe. Accepted only while the bet is pending (plus a short
  // grace after resolve so the final flush lands), clamped to the cap and a plausibility rate.
  //
  // Parsed by hand instead of zValidator because the final flush arrives via
  // navigator.sendBeacon, which can only send CORS-safelisted content types (text/plain) —
  // a content-type-gated JSON validator would reject exactly the write we most need.
  app.post('/:gameId/taps/:sessionId', async (c) => {
    const gameId = GameIdSchema.safeParse(c.req.param('gameId'));
    if (!gameId.success) {
      return c.json(
        { ok: false as const, error: 'invalid_game_id', code: 'validation_error' },
        400,
      );
    }
    const sessionId = z.uuid().safeParse(c.req.param('sessionId'));
    if (!sessionId.success) {
      return c.json(
        { ok: false as const, error: 'invalid_session_id', code: 'validation_error' },
        400,
      );
    }
    let count: number;
    let salt: string;
    try {
      const raw: unknown = JSON.parse(await c.req.text());
      const parsed = z
        .object({
          count: z.number().int().min(0).max(100_000),
          // The flip's 32-byte salt PREIMAGE (hex) — the bettor-only write proof.
          salt: z.string().regex(/^[0-9a-f]{64}$/i),
        })
        .safeParse(raw);
      if (!parsed.success) throw new Error('invalid body');
      count = parsed.data.count;
      salt = parsed.data.salt;
    } catch {
      return c.json({ ok: false as const, error: 'invalid_body', code: 'validation_error' }, 400);
    }

    try {
      const [row] = await db
        .select()
        .from(sessions)
        .innerJoin(bets, eq(sessions.betId, bets.id))
        .where(and(eq(sessions.id, sessionId.data), eq(sessions.gameId, gameId.data)))
        .limit(1);
      if (!row) {
        return c.json({ ok: false as const, error: 'not_found', code: 'session_not_found' }, 404);
      }
      const { sessions: session, bets: bet } = row;

      // Bettor-only gate: session ids are publicly discoverable (GET /:gameId/active/:address)
      // and recordBet is unauthenticated, so neither can authorize a write. Knowledge of the
      // salt preimage can: only the device that placed the flip ever held it (the chain and
      // the DB only see sha256(salt)). See saltProofValid for the full reasoning.
      if (!saltProofValid(salt, bet.saltHash)) {
        return c.json({ ok: false as const, error: 'invalid_salt_proof', code: 'forbidden' }, 403);
      }

      const resolved = bet.outcome !== 'pending';
      const inGrace =
        bet.resolvedAt !== null && Date.now() - bet.resolvedAt.getTime() <= TAP_GRACE_MS;
      if (resolved && !inGrace) {
        return c.json(
          { ok: false as const, error: 'tap_window_closed', code: 'tap_window_closed' },
          409,
        );
      }

      // Plausibility clamp: a human cannot tap faster than ~15/s; reports beyond
      // elapsed-time × rate (or the hard cap) are clamped, never rejected outright —
      // the legitimate portion of the count still banks.
      const elapsedSec = Math.max(0, (Date.now() - session.createdAt.getTime()) / 1000);
      const rateCeiling = Math.floor(elapsedSec * TAP_RATE_PER_SEC) + 1;
      const accepted = Math.min(count, TAP_CAP, rateCeiling);
      const points = tapPoints(session.id, accepted);

      // greatest() in SQL so concurrent batches can't regress the count (read-modify-write
      // in JS would lose the race). tapPoints is monotonic in taps, so greatest on both
      // columns stays mutually consistent.
      await db
        .update(bets)
        .set({
          taps: sql`greatest(${bets.taps}, ${accepted})`,
          tapPoints: sql`greatest(${bets.tapPoints}, ${points})`,
        })
        .where(eq(bets.id, bet.id));

      const taps = Math.max(bet.taps, accepted);
      return c.json({
        ok: true as const,
        data: {
          taps,
          tapPoints: Math.max(bet.tapPoints, points),
          goldenIndex: goldenIndex(session.id),
        },
      });
    } catch (err) {
      logger.error({ err, sessionId: sessionId.data }, 'failed to record taps');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  return app;
}
