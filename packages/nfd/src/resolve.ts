import type { NfdRecord } from './types.js';

const NFD_API_BASE = 'https://api.nf.domains';
/** OpenAPI maxItems for the `address` query param on /nfd/lookup. */
const MAX_BATCH = 20;

/** Raw shape of a single NFD record from `/nfd/lookup?view=tiny`. */
interface RawNfd {
  name?: string;
  expired?: boolean;
  state?: string;
  caAlgo?: string[];
  properties?: { userDefined?: { avatar?: string } };
}

export interface ResolveOptions {
  /** Injectable fetch (tests, non-global-fetch runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Reverse-resolve Algorand addresses to NFD names via the public nf.domains API.
 *
 * Returns a Map keyed by every input address. The value is a forward-verified
 * {@link NfdRecord} when the address owns a confirmed NFD (address present in
 * `caAlgo[]`), or `null` otherwise — no NFD, expired, an unconfirmed claim, or a
 * network failure. Never throws: resolution failures degrade to `null` so callers
 * fall back to a truncated address rather than crashing the UI.
 */
export async function resolveNfds(
  addresses: string[],
  options: ResolveOptions = {},
): Promise<Map<string, NfdRecord | null>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const unique = [...new Set(addresses.filter((a): a is string => Boolean(a)))];
  const out = new Map<string, NfdRecord | null>(unique.map((a) => [a, null]));
  if (unique.length === 0) return out;

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    chunks.push(unique.slice(i, i + MAX_BATCH));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const qs = chunk.map((a) => `address=${encodeURIComponent(a)}`).join('&');
      const url = `${NFD_API_BASE}/nfd/lookup?${qs}&view=tiny`;
      const json = await safeFetchJson(fetchImpl, url, options.signal);
      if (!json) return;
      for (const addr of chunk) {
        const record = parseRecord(addr, json[addr]);
        if (record) out.set(addr, record);
      }
    }),
  );

  return out;
}

/** Convenience single-address resolver. Returns `null` when unresolved. */
export async function resolveNfd(
  address: string,
  options: ResolveOptions = {},
): Promise<NfdRecord | null> {
  const map = await resolveNfds([address], options);
  return map.get(address) ?? null;
}

async function safeFetchJson(
  fetchImpl: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<Record<string, RawNfd | undefined> | null> {
  try {
    const res = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
    // 404 = no address in this chunk has an NFD; 429 = rate limited. Both → null fallback.
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!json || typeof json !== 'object') return null;
    return json as Record<string, RawNfd | undefined>;
  } catch {
    // Network error / abort / malformed JSON: degrade to the truncated-address fallback.
    // This is a deliberate typed degradation (null), not a swallowed error.
    return null;
  }
}

/** Only forward-verified, owned, non-expired records become an {@link NfdRecord}. */
function parseRecord(address: string, raw: RawNfd | undefined): NfdRecord | null {
  if (!raw || typeof raw.name !== 'string' || raw.name.length === 0) return null;
  if (raw.expired === true) return null;
  const caAlgo = Array.isArray(raw.caAlgo) ? raw.caAlgo : [];
  // Anti-spoof: require the on-chain verified link. An address present only in
  // unverifiedCaAlgo[] is a unilateral claim and must not be shown as an identity.
  if (!caAlgo.includes(address)) return null;
  const avatar = raw.properties?.userDefined?.avatar;
  return {
    name: raw.name,
    address,
    verified: true,
    avatar: typeof avatar === 'string' ? avatar : undefined,
  };
}
