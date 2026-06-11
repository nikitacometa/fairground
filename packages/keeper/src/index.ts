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

// Must be first: installs the global fetch proxy dispatcher (if HTTPS_PROXY is set)
// before any algod client issues a request. See proxy-bootstrap.ts for the rationale.
import './proxy-bootstrap.js';
import pino from 'pino';
import { Redis } from 'ioredis';
import algosdk from 'algosdk';
import { checkMainnetConfig } from '@fairground/types';
import { env } from './env.js';
import { acquireLock, refreshLock, releaseLock, REFRESH_INTERVAL_MS } from './lock.js';
import { resolveExpiredSessions } from './resolver.js';
import { sweepOrphanFlips } from './orphan-sweep.js';
import { runJackpotTick } from './jackpot.js';
import { runMigrations } from './migrate.js';

// Poll cadence for resolvable sessions. Kept tight so a flip resolves within a couple of
// seconds of its VRF round landing (the on-chain N+8 commit is the irreducible floor).
const POLL_INTERVAL_MS = 2_500;
// Orphan box sweep runs every Nth tick (~20s): it is a safety net, not a hot path, and the
// box-list call is the only cost when nothing is stranded.
const SWEEP_EVERY_TICKS = 8;

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('error', (err) => logger.error({ err }, 'Redis error'));

const algodClient = new algosdk.Algodv2(env.ALGOD_TOKEN, env.ALGOD_URL, '');

// One-shot egress IP check at startup. Uses the same global fetch path as algosdk,
// so the logged IP proves whether the proxy dispatcher is actually intercepting
// outbound requests (residential proxy IP vs the bare VPS IP). Non-fatal.
void fetch('https://api.ipify.org')
  .then((r) => r.text())
  .then((ip) =>
    logger.info(
      {
        egressIp: ip.trim(),
        proxied: Boolean(process.env['HTTPS_PROXY'] ?? process.env['HTTP_PROXY']),
      },
      'keeper egress IP',
    ),
  )
  .catch((err: unknown) => logger.warn({ err }, 'egress IP check failed'));

async function runLoop(): Promise<void> {
  logger.info({ instanceId: env.KEEPER_INSTANCE_ID }, 'keeper starting');

  // Apply DB migrations before processing. Idempotent and Postgres advisory-locked, so it
  // is safe for both primary and standby to call concurrently. Without this a fresh deploy
  // runs against an empty schema and resolves nothing. (audit 2026-06-04)
  await runMigrations(env.DATABASE_URL);

  // Loud config-drift check: a mainnet keeper pointed at the dead beacon resolves nothing.
  for (const p of checkMainnetConfig({
    network: env.ALGORAND_NETWORK,
    vrfBeaconAppId: env.VRF_BEACON_APP_ID,
    coinflipAppId: env.COINFLIP_APP_ID,
    houseTreasuryAppId: env.HOUSE_TREASURY_APP_ID,
    corsOrigins: env.CORS_ORIGINS,
  })) {
    logger.error({ key: p.key }, `CONFIG DRIFT: ${p.message}`);
  }

  let hasLock = false;
  let lockRefreshTimer: ReturnType<typeof setInterval> | null = null;
  // A resolve batch waits on-chain for each resolve() to confirm, so it can run far longer than
  // POLL_INTERVAL_MS. setInterval keeps firing regardless, so without this guard a slow batch would
  // overlap the next tick(s) — and a still-'pending' session not yet marked 'resolving' could be
  // picked up and resolve()'d twice (the second reverts on-chain, churns the DB, and multiplies
  // algod calls). The guard makes ticks strictly serial: a beat is skipped if one is still running.
  let tickRunning = false;
  let tickCount = 0;

  const clearRefresh = (): void => {
    if (lockRefreshTimer) {
      clearInterval(lockRefreshTimer);
      lockRefreshTimer = null;
    }
  };

  const tick = async (): Promise<void> => {
    if (tickRunning) return;
    tickRunning = true;
    try {
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

      // Self-healing for flips the client never reported (lost connectivity after signing):
      // register any on-chain flip box with no DB session so the resolver settles it.
      tickCount += 1;
      if (tickCount % SWEEP_EVERY_TICKS === 1) {
        try {
          const status = await algodClient.status().do();
          await sweepOrphanFlips(logger, env.COINFLIP_APP_ID, status.lastRound);
        } catch (err) {
          logger.error({ err }, 'orphan sweep error');
        }
      }

      try {
        await runJackpotTick(algodClient, redis, logger, env.HOUSE_SEED_WALLET_MNEMONIC);
      } catch (err) {
        logger.error({ err }, 'jackpot tick error');
      }
    } finally {
      tickRunning = false;
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
