/**
 * FairJackpot (Daily Pot) public API.
 *
 *   GET /jackpot              — current pot state + last draw. Redis 5 s.
 *   GET /jackpot?address=ADDR — adds myTickets + myWageredThisEpoch. Redis 5 s per addr.
 *   GET /jackpot/draws        — draw history from Postgres (newest first). Redis 10 s.
 *
 * All bigint values serialized as plain decimal strings. JACKPOT_APP_ID === 0n → 503 on
 * every route (jackpot not configured yet — graceful degrade, no crash).
 */

import { Hono } from 'hono';
import { db, draws } from '@fairground/db';
import { desc } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { lookupNfd } from '@fairground/nfd';
import { env } from '../env.js';
import { fetchCoinflipConfig, fetchJackpotState, decodeAlgoAddress } from '../onchain.js';

// RunnerUp shape as stored in the draws.runnersUp JSONB column (by the keeper).
interface StoredRunnerUp {
  address: string;
  nfd: string | null;
  payoutMicroalgo: string;
}

function parseRunnersUp(raw: unknown): StoredRunnerUp[] {
  if (!Array.isArray(raw)) return [];
  const result: StoredRunnerUp[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r['address'] !== 'string') continue;
    result.push({
      address: r['address'],
      nfd: typeof r['nfd'] === 'string' ? r['nfd'] : null,
      payoutMicroalgo: typeof r['payoutMicroalgo'] === 'string' ? r['payoutMicroalgo'] : '0',
    });
  }
  return result;
}

/** Resolve winner NFD: prefer stored value, fall back to live lookup on null. */
async function resolveWinnerNfd(
  redis: Redis,
  logger: Logger,
  winnerAddress: string,
  storedNfd: string | null,
): Promise<string | null> {
  if (storedNfd !== null) return storedNfd;
  const cacheKey = `nfd:${winnerAddress}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached || null;
    const lookup = await lookupNfd(winnerAddress);
    if (lookup.status === 'error') return null;
    const name = lookup.status === 'resolved' ? lookup.record.name : null;
    await redis.set(cacheKey, name ?? '', 'EX', 600);
    return name;
  } catch (err) {
    logger.warn({ err, address: winnerAddress }, 'nfd resolve failed for jackpot winner');
    return null;
  }
}

interface DrawRow {
  epochId: bigint;
  potMicroalgo: bigint;
  rolloverMicroalgo: bigint;
  totalTickets: bigint;
  vrfRound: bigint | null;
  drawnAt: Date | null;
  proofCardUrl: string | null;
  winnerAddress: string | null;
  winnerNfd: string | null;
  winnerPayoutMicroalgo: bigint | null;
  runnersUp: unknown;
  state: string;
}

function drawRowToWire(
  row: DrawRow,
  origin: string,
): {
  epochId: string;
  potMicroalgo: string;
  rolloverMicroalgo: string;
  totalTickets: string;
  vrfRound: string;
  drawnAt: string | null;
  proofUrl: string | null;
  winner: { address: string; nfd: string | null; payoutMicroalgo: string } | null;
  runnersUp: StoredRunnerUp[];
} {
  const runners = parseRunnersUp(row.runnersUp);
  const hasResult = row.winnerAddress !== null;
  // Absolute URL: Twitter's og:image crawler and external API consumers fetch this
  // verbatim — a relative path 404s. The stored proofCardUrl is relative by design.
  const proofPath = row.proofCardUrl ?? `/proof/draw/${row.epochId.toString()}`;
  return {
    epochId: row.epochId.toString(),
    potMicroalgo: row.potMicroalgo.toString(),
    rolloverMicroalgo: row.rolloverMicroalgo.toString(),
    totalTickets: row.totalTickets.toString(),
    vrfRound: (row.vrfRound ?? 0n).toString(),
    drawnAt: row.drawnAt?.toISOString() ?? null,
    proofUrl: hasResult
      ? proofPath.startsWith('http')
        ? proofPath
        : `${origin}${proofPath}`
      : null,
    winner: hasResult
      ? {
          address: row.winnerAddress ?? '',
          nfd: row.winnerNfd,
          payoutMicroalgo: (row.winnerPayoutMicroalgo ?? 0n).toString(),
        }
      : null,
    runnersUp: runners,
  };
}

const NOT_CONFIGURED = {
  ok: false as const,
  error: 'jackpot_not_configured',
  code: 'jackpot_not_configured',
} as const;

export function makeJackpotRouter(logger: Logger, redis: Redis): Hono {
  const app = new Hono();

  // GET /jackpot/draws must be registered before GET /jackpot so Hono doesn't
  // consume "draws" as an address query param on the root route.

  // GET /jackpot/draws?limit=30
  app.get('/draws', async (c) => {
    if (env.JACKPOT_APP_ID === 0n) {
      return c.json(NOT_CONFIGURED, 503);
    }
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '30', 10) || 30, 1), 100);
    const cacheKey = `jackpot:draws:${limit}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        c.header('Cache-Control', 'public, max-age=10');
        return c.body(cached, 200, { 'Content-Type': 'application/json' });
      }

      const rows = await db
        .select({
          epochId: draws.epochId,
          potMicroalgo: draws.potMicroalgo,
          rolloverMicroalgo: draws.rolloverMicroalgo,
          totalTickets: draws.totalTickets,
          vrfRound: draws.vrfRound,
          drawnAt: draws.drawnAt,
          proofCardUrl: draws.proofCardUrl,
          winnerAddress: draws.winnerAddress,
          winnerNfd: draws.winnerNfd,
          winnerPayoutMicroalgo: draws.winnerPayoutMicroalgo,
          runnersUp: draws.runnersUp,
          state: draws.state,
        })
        .from(draws)
        .orderBy(desc(draws.epochId))
        .limit(limit);

      const origin = new URL(c.req.url).origin;
      const payload = JSON.stringify({
        ok: true as const,
        data: rows.map((r) => drawRowToWire(r, origin)),
      });

      await redis.set(cacheKey, payload, 'EX', 10);
      c.header('Cache-Control', 'public, max-age=10');
      return c.body(payload, 200, { 'Content-Type': 'application/json' });
    } catch (err) {
      logger.error({ err }, 'failed to fetch jackpot draw history');
      return c.json({ ok: false as const, error: 'internal_error', code: 'jackpot_error' }, 500);
    }
  });

  // GET /jackpot (optionally ?address=ALGOADDR)
  app.get('/', async (c) => {
    if (env.JACKPOT_APP_ID === 0n) {
      return c.json(NOT_CONFIGURED, 503);
    }

    const rawAddr = c.req.query('address');
    const address = rawAddr?.trim() ?? null;

    // Validate address early so we don't waste a chain fetch for a bad address.
    let addressPk: Uint8Array | null = null;
    if (address !== null) {
      addressPk = decodeAlgoAddress(address);
      if (addressPk === null) {
        return c.json(
          { ok: false as const, error: 'invalid_address', code: 'validation_error' },
          400,
        );
      }
    }

    const cacheKey = address ? `jackpot:state:${address}` : 'jackpot:state';

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        c.header('Cache-Control', 'public, max-age=5');
        return c.body(cached, 200, { 'Content-Type': 'application/json' });
      }

      // Fetch on-chain state and coinflip config concurrently.
      const [jackpotState, coinflipConfig] = await Promise.all([
        fetchJackpotState(redis, logger),
        fetchCoinflipConfig(redis, logger),
      ]);

      if (jackpotState === null) {
        return c.json(
          { ok: false as const, error: 'jackpot_unavailable', code: 'chain_error' },
          503,
        );
      }

      // jackpotBps from coinflip global state (D13). Falls back to 0 (no jackpot on v1).
      const jackpotBps =
        coinflipConfig?.jackpotBps !== undefined ? Number(coinflipConfig.jackpotBps) : 0;

      // Pending draw exists when pending_epoch != 0.
      const pendingDraw =
        jackpotState.pendingEpoch !== 0n
          ? {
              epochId: jackpotState.pendingEpoch.toString(),
              commitRound: jackpotState.pendingCommitRound.toString(),
              potMicroalgo: jackpotState.pendingPot.toString(),
              totalTickets: jackpotState.pendingTotalTickets.toString(),
            }
          : null;

      // Last resolved draw from Postgres.
      const [lastDrawRow] = await db
        .select({
          epochId: draws.epochId,
          potMicroalgo: draws.potMicroalgo,
          rolloverMicroalgo: draws.rolloverMicroalgo,
          totalTickets: draws.totalTickets,
          vrfRound: draws.vrfRound,
          drawnAt: draws.drawnAt,
          proofCardUrl: draws.proofCardUrl,
          winnerAddress: draws.winnerAddress,
          winnerNfd: draws.winnerNfd,
          winnerPayoutMicroalgo: draws.winnerPayoutMicroalgo,
          runnersUp: draws.runnersUp,
          state: draws.state,
        })
        .from(draws)
        .orderBy(desc(draws.epochId))
        .limit(1);

      let lastDraw: ReturnType<typeof drawRowToWire> | null = null;
      if (lastDrawRow?.winnerAddress) {
        // Resolve winner NFD with live fallback (single wallet, negligible overhead).
        const winnerNfd = await resolveWinnerNfd(
          redis,
          logger,
          lastDrawRow.winnerAddress,
          lastDrawRow.winnerNfd,
        );
        const rowWithNfd = { ...lastDrawRow, winnerNfd };
        lastDraw = drawRowToWire(rowWithNfd, new URL(c.req.url).origin);
      }

      // Player-specific box read: epoch accumulator box for this address.
      let myTickets: string | undefined;
      let myWageredThisEpoch: string | undefined;
      if (address !== null && addressPk !== null) {
        try {
          const prefix = Buffer.from('t', 'utf8');
          const epochBytes = Buffer.alloc(8);
          epochBytes.writeBigUInt64BE(jackpotState.epochId);
          const boxKey = Buffer.concat([prefix, epochBytes, Buffer.from(addressPk)]);
          const b64Key = 'b64:' + boxKey.toString('base64');
          const headers: Record<string, string> = env.ALGOD_TOKEN
            ? { 'X-Algo-API-Token': env.ALGOD_TOKEN }
            : {};
          const boxRes = await fetch(
            `${env.ALGOD_URL}/v2/applications/${env.JACKPOT_APP_ID}/box?name=${encodeURIComponent(b64Key)}`,
            { headers, signal: AbortSignal.timeout(4000) },
          );
          if (boxRes.ok) {
            const boxBody = (await boxRes.json()) as { value?: string };
            if (boxBody.value) {
              const valueBytes = Buffer.from(boxBody.value, 'base64');
              if (valueBytes.length >= 16) {
                const wagered = valueBytes.readBigUInt64BE(0);
                const tickets = valueBytes.readBigUInt64BE(8);
                myWageredThisEpoch = wagered.toString();
                myTickets = tickets.toString();
              }
            }
          } else if (boxRes.status !== 404) {
            logger.warn(
              { status: boxRes.status, address },
              'unexpected status reading jackpot player box',
            );
          }
        } catch (boxErr) {
          logger.warn({ err: boxErr, address }, 'jackpot player box read failed');
        }
        // 404 → player has no box this epoch → myTickets/myWageredThisEpoch stay undefined
        // (field absent from response matches the "present only when ?address given" contract)
        if (myTickets === undefined) {
          myTickets = '0';
          myWageredThisEpoch = '0';
        }
      }

      const nextDrawAt = new Date(Number(jackpotState.epochCloseTs) * 1000).toISOString();

      const responseData: Record<string, unknown> = {
        potMicroalgo: jackpotState.potBalance.toString(),
        epochId: jackpotState.epochId.toString(),
        nextDrawAt,
        totalTickets: jackpotState.epochTotalTickets.toString(),
        totalEntries: jackpotState.epochEntryCount.toString(),
        rolloverMicroalgo: jackpotState.lastRollover.toString(),
        paused: jackpotState.paused,
        pendingDraw,
        params: {
          jackpotBps,
          winnerBps: Number(jackpotState.winnerBps),
          runnerBps: Number(jackpotState.runnerBps),
          runnerCount: Number(jackpotState.runnerCount),
          backstopMicroalgo: jackpotState.backstopMicroalgo.toString(),
        },
        lastDraw,
      };

      if (myTickets !== undefined) responseData['myTickets'] = myTickets;
      if (myWageredThisEpoch !== undefined) responseData['myWageredThisEpoch'] = myWageredThisEpoch;

      const payload = JSON.stringify({ ok: true as const, data: responseData });
      await redis.set(cacheKey, payload, 'EX', 5);
      c.header('Cache-Control', 'public, max-age=5');
      return c.body(payload, 200, { 'Content-Type': 'application/json' });
    } catch (err) {
      logger.error({ err }, 'failed to build jackpot state response');
      return c.json({ ok: false as const, error: 'internal_error', code: 'jackpot_error' }, 500);
    }
  });

  return app;
}
