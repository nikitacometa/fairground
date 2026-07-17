import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod/v4';
import { db } from '@fairground/db';
import { bets, sessions } from '@fairground/db';
import { GameIdSchema } from '@fairground/types';
import {
  createAlgorandClientFromEnv,
  createIndexerFlipTransactionLookup,
  FlipTransactionVerificationError,
  verifyFlipTransaction,
  type FlipTransactionClaims,
  type VerifiedFlipTransaction,
} from '@fairground/sdk';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { computeWinStreak } from '../lib/streak.js';
import {
  BetChainIdentityConflictError,
  registerVerifiedBet,
  type RegisterVerifiedBetInput,
  type RegisteredBet,
} from '../lib/register-bet.js';
import {
  TAP_CAP,
  TAP_GRACE_MS,
  TAP_RATE_PER_SEC,
  goldenIndex,
  saltProofValid,
  tapPoints,
} from '../lib/fairPoints.js';
import { env } from '../env.js';

interface BetsRouterDependencies {
  verifyFlip: (claims: FlipTransactionClaims) => Promise<VerifiedFlipTransaction>;
  registerBet: (input: RegisterVerifiedBetInput) => Promise<RegisteredBet>;
}

function defaultBetsRouterDependencies(): BetsRouterDependencies {
  const algorand = createAlgorandClientFromEnv();
  const lookup = createIndexerFlipTransactionLookup(algorand.client.indexer);
  return {
    verifyFlip: (claims) => verifyFlipTransaction(lookup, env.COINFLIP_APP_ID, claims),
    registerBet: (input) => registerVerifiedBet(db, input),
  };
}

export function makeBetsRouter(
  logger: Logger,
  dependencies: BetsRouterDependencies = defaultBetsRouterDependencies(),
): Hono {
  const app = new Hono();

  // POST /games/:gameId/bets
  // Called by the frontend after flip() txn is confirmed on-chain.
  app.post(
    '/:gameId/bets',
    zValidator(
      'json',
      z.object({
        walletAddress: z.string().min(58).max(58),
        txnId: z.string().regex(/^[A-Z2-7]{52}$/), // confirmed flip() txn ID
        vrfRound: z.string().transform((s) => BigInt(s)), // commit_round as string
        saltHash: z.string().length(64),
        amountMicroalgo: z.string().transform((s) => BigInt(s)),
        playerPick: z.enum(['heads', 'tails']).optional(),
        referrerWallet: z.string().length(58).nullable().optional(),
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

      // This verifier is bound to COINFLIP_APP_ID. Do not let another game id decorate a
      // confirmed coinflip row until that game has its own chain verifier and contract mapping.
      if (gameId.data !== 'coinflip') {
        return c.json(
          { ok: false as const, error: 'unsupported_game', code: 'chain_verification_error' },
          400,
        );
      }

      try {
        // Chain verification is deliberately the first I/O: even retries and swept-row adoption
        // cannot mutate Postgres until the app call and its payment group are proven confirmed.
        const verified = await dependencies.verifyFlip({
          txnId: body.txnId,
          walletAddress: body.walletAddress,
          amountMicroalgo: body.amountMicroalgo,
          vrfRound: body.vrfRound,
          saltHash: body.saltHash,
          referrerWallet: body.referrerWallet ?? null,
        });
        const registered = await dependencies.registerBet({
          ...verified,
          gameId: 'coinflip',
          // playerPick is not an argument to flip() and cannot be authenticated from chain.
          playerPick: null,
        });

        logger.info(
          {
            betId: registered.betId,
            sessionId: registered.sessionId,
            walletAddress: verified.walletAddress,
            txnId: verified.txnId,
            created: registered.created,
          },
          registered.created ? 'bet registered' : 'bet registration replayed',
        );

        // Serialize bigint as string for JSON transport. sessionId is what the client
        // polls GET /games/:gameId/state/:sessionId with, so it must be returned here.
        return c.json({
          ok: true as const,
          data: {
            betId: registered.betId,
            sessionId: registered.sessionId,
            vrfRound: registered.vrfRound.toString(),
            amountMicroalgo: registered.amountMicroalgo.toString(),
          },
        });
      } catch (err) {
        if (err instanceof FlipTransactionVerificationError) {
          const status =
            err.code === 'transaction_not_found'
              ? 404
              : err.code === 'chain_unavailable'
                ? 502
                : 422;
          logger.warn({ code: err.code, txnId: body.txnId }, 'flip transaction rejected');
          return c.json(
            { ok: false as const, error: err.code, code: 'chain_verification_error' },
            status,
          );
        }
        if (err instanceof BetChainIdentityConflictError) {
          logger.warn({ err, txnId: body.txnId }, 'bet chain identity conflict');
          return c.json(
            { ok: false as const, error: 'chain_identity_conflict', code: 'conflict' },
            409,
          );
        }
        logger.error({ err }, 'failed to register bet');
        return c.json(
          { ok: false as const, error: 'internal_error', code: 'upstream_or_db_error' },
          500,
        );
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
