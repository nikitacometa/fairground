/**
 * @fairground/keeper -- VRF session resolver.
 *
 * Two instances run in Docker Compose (primary + standby).
 * Redis SETNX lock with 10s TTL, refreshed every 4s.
 * If primary crashes, standby acquires lock within 10s.
 *
 * Keeper SLA (non-negotiable):
 *   Resolve all sessions within 60 minutes of commit_round passing.
 *   The Applied Blockchain beacon stores only the last 189 outputs (~70 min).
 *   After 70 min, must_get() panics and the session becomes unresolvable.
 *   Minimum: run the keeper 24/7 with restart: always in Docker Compose.
 *
 * 48h refund backdoor:
 *   If this keeper is down and a session ages past 48h, the player can
 *   call CoinflipContract.refund() directly. Keeper failure never locks funds.
 */

import pino from 'pino';
import { Redis } from 'ioredis';
import algosdk from 'algosdk';
import { env } from './env.js';
import { acquireLock, refreshLock, releaseLock, REFRESH_INTERVAL_MS } from './lock.js';
import { resolveExpiredSessions } from './resolver.js';

const POLL_INTERVAL_MS = 4_000;

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('error', (err) => logger.error({ err }, 'Redis error'));

const algodClient = new algosdk.Algodv2(env.ALGOD_TOKEN, env.ALGOD_URL, '');

async function runLoop(): Promise<void> {
  logger.info({ instanceId: env.KEEPER_INSTANCE_ID }, 'keeper starting');

  let hasLock = false;
  let lockRefreshTimer: ReturnType<typeof setInterval> | null = null;

  const clearRefresh = (): void => {
    if (lockRefreshTimer) {
      clearInterval(lockRefreshTimer);
      lockRefreshTimer = null;
    }
  };

  const tick = async (): Promise<void> => {
    if (!hasLock) {
      hasLock = await acquireLock(redis, env.KEEPER_INSTANCE_ID, logger);
      if (hasLock) {
        // Start lock refresh on its own interval
        lockRefreshTimer = setInterval(() => {
          refreshLock(redis, env.KEEPER_INSTANCE_ID, logger)
            .then((ok) => {
              if (!ok) {
                hasLock = false;
                clearRefresh();
              }
            })
            .catch((err) => logger.error({ err }, 'lock refresh error'));
        }, REFRESH_INTERVAL_MS);
      } else {
        logger.debug({ instanceId: env.KEEPER_INSTANCE_ID }, 'standby -- waiting for lock');
        return;
      }
    }

    // This instance is the leader -- resolve sessions
    try {
      await resolveExpiredSessions(
        algodClient,
        redis,
        logger,
        env.COINFLIP_APP_ID,
        env.HOUSE_TREASURY_APP_ID,
        env.VRF_BEACON_APP_ID,
        env.HOUSE_SEED_WALLET_MNEMONIC,
      );
    } catch (err) {
      logger.error({ err }, 'resolve loop error');
    }
  };

  // Initial tick
  await tick();

  // Recurring loop
  const timer = setInterval(() => {
    tick().catch((err) => logger.error({ err }, 'tick error'));
  }, POLL_INTERVAL_MS);

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down keeper');
    clearInterval(timer);
    clearRefresh();
    await releaseLock(redis, env.KEEPER_INSTANCE_ID);
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

runLoop().catch((err) => {
  logger.error({ err }, 'keeper fatal error');
  process.exit(1);
});
