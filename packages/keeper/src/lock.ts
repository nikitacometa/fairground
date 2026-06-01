import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

const LOCK_KEY = 'fairground:keeperlock';
const LOCK_TTL_MS = 10_000; // 10 seconds
const REFRESH_INTERVAL_MS = 4_000; // refresh every 4 seconds

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
  const result = await redis.set(LOCK_KEY, instanceId, 'PX', LOCK_TTL_MS, 'NX');
  if (result === 'OK') {
    logger.info({ instanceId }, 'keeper lock acquired');
    return true;
  }
  return false;
}

/**
 * Refresh the lock TTL atomically.
 *
 * Uses a Lua script so GET + PEXPIRE executes as a single atomic operation.
 * Without atomicity: two instances could both GET, see their own value, and
 * both extend -- but only one of them actually holds the lock (TOCTOU race).
 *
 * Returns false if the lock is no longer held by this instance.
 */
export async function refreshLock(
  redis: Redis,
  instanceId: string,
  logger: Logger,
): Promise<boolean> {
  // Lua: PEXPIRE only if the current value matches instanceId.
  // Returns 1 on success, 0 if key is missing or held by another instance.
  const lua = `
    local val = redis.call('GET', KEYS[1])
    if val == ARGV[1] then
      return redis.call('PEXPIRE', KEYS[1], ARGV[2])
    end
    return 0
  `;
  const result = await redis.eval(lua, 1, LOCK_KEY, instanceId, String(LOCK_TTL_MS));
  if (result !== 1) {
    const current = await redis.get(LOCK_KEY);
    logger.warn({ instanceId, current }, 'keeper lock was stolen or expired');
    return false;
  }
  return true;
}

/**
 * Release the lock atomically. Called on graceful shutdown.
 *
 * Uses a Lua script so GET + DEL executes atomically.
 * Without atomicity: instance A could GET (sees own value), then lose the CPU,
 * instance B acquires the lock, then instance A wakes and DELs B's lock.
 */
export async function releaseLock(redis: Redis, instanceId: string): Promise<void> {
  // Lua: DEL only if the current value matches instanceId.
  const lua = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;
  await redis.eval(lua, 1, LOCK_KEY, instanceId);
}

export { REFRESH_INTERVAL_MS };
