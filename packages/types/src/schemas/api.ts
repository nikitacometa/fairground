/**
 * API envelope types + bigint JSON helpers shared by @fairground/api,
 * the game dApp, and the landing site.
 *
 * Every API response is an ApiResult<T>. bigint fields are serialized as
 * strings on the wire (JSON.stringify throws on bigint); callers convert the
 * known fields back with BigInt(), and bigintReviver handles the optional
 * "123n"-suffixed variant defensively.
 */

/** Discriminated result envelope returned by every endpoint. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

/**
 * JSON.parse reviver that restores bigints written with a trailing "n"
 * (e.g. "12345n"). Plain numeric strings are left untouched — only the
 * caller knows which of those are meant to be bigint, so those are converted
 * explicitly at the call site.
 */
export function bigintReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}

/**
 * Recursively convert bigint values to plain strings so a payload is
 * JSON-safe. Mirrors the BetWire convention (plain numeric string, no "n").
 */
export function serializeBigInts<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serializeBigInts(v)]),
    );
  }
  return value;
}
