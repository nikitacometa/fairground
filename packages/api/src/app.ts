import { Hono } from 'hono';
import pino from 'pino';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { Redis } from 'ioredis';
import { env } from './env.js';
import { geoBlock } from './middleware/geo-block.js';
import { makeBetsRouter } from './routes/bets.js';
import { makeLeaderboardRouter } from './routes/leaderboard.js';
import { makeProofRouter } from './routes/proof.js';
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

  // Health
  app.get('/health', (c) => c.json({ ok: true as const, data: { version: '0.1.0' } }));

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

  return app;
}
