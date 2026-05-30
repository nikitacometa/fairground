import type Redis from 'ioredis';
import type { Logger } from 'pino';

const LOCK_KEY = 'fairground:keeperlock';
const LOCK_TTL_MS = 10_000;  // 10 seconds
const REFRESH_INTERVAL_MS = 4_000;  // refresh every 4 seconds

/**
 * Acquire Redis SETNX leader lock.
 *
 * Two keeper instances (primary + standby) compete for this lock.
 * The one that acquires it becomes leader and runs the resolve loop.
 * If primary crashes, TTL expires and standby acquires within 10s.
 *
 * @returns true if this instance acquired the lock
 */
export async function acquireLock(
  redis: Redis,
  instanceId: string,
  logger: Logger,
): Promise<boolean> {
  // SET key value NX PX ttl -- atomic test-and-set
  const result = await redis.set(LOCK_KEY, instanceId, 'NX', 'PX', LOCK_TTL_MS);
  if (result === 'OK') {
    logger.info({ instanceId }, 'keeper lock acquired');
    return true;
  }
  return false;
}

/**
 * Refresh the lock TTL. Call every REFRESH_INTERVAL_MS while holding the lock.
 * Returns false if lock was stolen (another instance holds it now).
 */
export async function refreshLock(
  redis: Redis,
  instanceId: string,
  logger: Logger,
): Promise<boolean> {
  const current = await redis.get(LOCK_KEY);
  if (current !== instanceId) {
    logger.warn({ instanceId, current }, 'keeper lock was stolen');
    return false;
  }
  await redis.pexpire(LOCK_KEY, LOCK_TTL_MS);
  return true;
}

/**
 * Release the lock. Called on graceful shutdown.
 */
export async function releaseLock(redis: Redis, instanceId: string): Promise<void> {
  const current = await redis.get(LOCK_KEY);
  if (current === instanceId) {
    await redis.del(LOCK_KEY);
  }
}

export { REFRESH_INTERVAL_MS };
