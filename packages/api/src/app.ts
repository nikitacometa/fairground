import { Hono } from 'hono';
import pino from 'pino';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { Redis } from 'ioredis';
import { PLATFORM_VERSION, CONTRACTS, checkMainnetConfig } from '@fairground/types';
import { env } from './env.js';
import { geoBlock } from './middleware/geo-block.js';
import { makeBetsRouter } from './routes/bets.js';
import { makeLeaderboardRouter } from './routes/leaderboard.js';
import { makeProofRouter } from './routes/proof.js';
import { makeStatsRouter } from './routes/stats.js';
import { wsRoute } from './routes/ws.js';

export const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

// Prometheus metrics registry
const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));

export function createApp(): Hono {
  const app = new Hono();

  // Loud config-drift check (audit 2026-06-04): a mainnet API pointed at the dead beacon or
  // the wrong CORS domain breaks silently. Shout at startup, don't brick.
  for (const p of checkMainnetConfig({
    network: env.ALGORAND_NETWORK,
    vrfBeaconAppId: env.VRF_BEACON_APP_ID,
    coinflipAppId: env.COINFLIP_APP_ID,
    houseTreasuryAppId: env.HOUSE_TREASURY_APP_ID,
    corsOrigins: env.CORS_ORIGINS,
  })) {
    logger.error({ key: p.key }, `CONFIG DRIFT: ${p.message}`);
  }

  // Geo-block: US, UK, TH, ID, IN, BR -- required before any public announcement
  app.use('*', geoBlock);

  // CORS
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin') ?? '';
    if (env.CORS_ORIGINS.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
    return;
  });

  // Prometheus metrics endpoint (not geo-blocked -- internal use only)
  app.get('/metrics', async (c) => {
    const metrics = await registry.metrics();
    c.header('Content-Type', registry.contentType);
    return c.body(metrics);
  });

  // Health -- liveness only (does not reflect keeper state).
  app.get('/health', (c) => c.json({ ok: true as const, data: { version: PLATFORM_VERSION } }));

  // Status -- what is deployed: platform version, network, git sha, and the canonical
  // on-chain contract registry. The machine-readable half of the versioning scheme.
  app.get('/status', (c) =>
    c.json({
      ok: true as const,
      data: {
        version: PLATFORM_VERSION,
        network: env.ALGORAND_NETWORK,
        gitSha: process.env['GIT_SHA'] ?? 'unknown',
        contracts: {
          coinflip: {
            appId: CONTRACTS.coinflip.appId.toString(),
            version: CONTRACTS.coinflip.version,
          },
          houseTreasury: {
            appId: CONTRACTS.houseTreasury.appId.toString(),
            version: CONTRACTS.houseTreasury.version,
          },
        },
        vrfBeaconAppId: env.VRF_BEACON_APP_ID.toString(),
      },
    }),
  );

  // WebSocket -- upgrade handled by @hono/node-server via the 'upgrade' event
  app.get('/ws', wsRoute);

  // Game routes
  const betsRouter = makeBetsRouter(logger);
  app.route('/games', betsRouter);

  // Leaderboard
  const leaderboardRouter = makeLeaderboardRouter(logger);
  app.route('/leaderboard', leaderboardRouter);

  // Proof cards
  const proofRouter = makeProofRouter(logger, redis);
  app.route('/proof', proofRouter);

  // Live stats for the landing page
  app.route('/stats', makeStatsRouter(logger));

  return app;
}
