/**
 * Shared algod utilities for the keeper.
 *
 * Raw global state decoding (no extra deps) and binary encoding helpers used by
 * the jackpot keeper and the house-edge-bps cache in the resolver.
 */

interface AlgodGlobalStateEntry {
  key: string;
  value: { type: number; uint?: number | string; bytes?: string };
}

/** Encode a uint64 as an 8-byte big-endian Uint8Array (mirrors Algorand's itob). */
export function itob8(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/**
 * Fetch and decode the uint64 global state entries of an Algorand application via raw REST.
 * Returns only type-2 (uint) entries; byte/address values are excluded.
 * Throws on network or HTTP errors — callers decide on fallback strategy.
 */
export async function readGlobalState(
  algodUrl: string,
  algodToken: string,
  appId: bigint,
): Promise<Map<string, bigint>> {
  const headers: Record<string, string> = algodToken ? { 'X-Algo-API-Token': algodToken } : {};
  const res = await fetch(`${algodUrl}/v2/applications/${appId.toString()}`, {
    headers,
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error(`algod GET /v2/applications/${appId.toString()} returned ${res.status}`);
  }
  const body = (await res.json()) as {
    params?: { 'global-state'?: AlgodGlobalStateEntry[] };
  };
  const state = new Map<string, bigint>();
  for (const e of body.params?.['global-state'] ?? []) {
    if (e.value.type === 2) {
      const key = Buffer.from(e.key, 'base64').toString('utf8');
      state.set(key, BigInt(e.value.uint ?? 0));
    }
  }
  return state;
}
