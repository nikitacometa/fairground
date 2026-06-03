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
 * Outcome of a single reverse lookup, separating a *confirmed* miss from a *transient*
 * failure. Paths that persist the result (e.g. permanent proof-card caching) must use this
 * so a temporary nf.domains outage is never baked in as "no NFD".
 */
export type NfdLookup =
  | { status: 'resolved'; record: NfdRecord }
  | { status: 'none' } // the address provably has no current, verified NFD
  | { status: 'error' }; // lookup failed (network / 429 / 5xx / malformed) — state unknown

/** Internal: a fetch either yields parsed data, a confirmed empty (404), or a failure. */
type FetchOutcome =
  | { kind: 'data'; data: Record<string, RawNfd | undefined> }
  | { kind: 'none' } // HTTP 404 — none of the queried addresses has an NFD
  | { kind: 'error' }; // transport/transient failure — must NOT be treated as a miss

/**
 * Reverse-resolve Algorand addresses to NFD names via the public nf.domains API.
 *
 * Returns a Map keyed by every input address. The value is a forward-verified
 * {@link NfdRecord} when the address owns a confirmed NFD (address present in
 * `caAlgo[]`), or `null` otherwise — no NFD, expired, an unconfirmed claim, or a
 * network failure. Never throws. This degrade-to-null behaviour suits ephemeral
 * display (a missing name just shows a truncated address and retries next session);
 * for anything that persists the result, use {@link lookupNfd} instead.
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
      const outcome = await fetchLookup(fetchImpl, lookupUrl(chunk), options.signal);
      // 'none' and 'error' both leave the chunk at its null default (ephemeral display).
      if (outcome.kind !== 'data') return;
      for (const addr of chunk) {
        const record = parseRecord(addr, outcome.data[addr]);
        if (record) out.set(addr, record);
      }
    }),
  );

  return out;
}

/** Convenience single-address resolver. Returns `null` when unresolved or on failure. */
export async function resolveNfd(
  address: string,
  options: ResolveOptions = {},
): Promise<NfdRecord | null> {
  const map = await resolveNfds([address], options);
  return map.get(address) ?? null;
}

/**
 * Single-address lookup that distinguishes a confirmed miss from a transient failure.
 * Use this on paths that persist the result (e.g. permanent proof-card caching) so a
 * temporary nf.domains outage or rate-limit is never frozen in as "no NFD".
 */
export async function lookupNfd(address: string, options: ResolveOptions = {}): Promise<NfdLookup> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outcome = await fetchLookup(fetchImpl, lookupUrl([address]), options.signal);
  if (outcome.kind === 'error') return { status: 'error' };
  if (outcome.kind === 'none') return { status: 'none' };
  const record = parseRecord(address, outcome.data[address]);
  return record ? { status: 'resolved', record } : { status: 'none' };
}

function lookupUrl(addresses: string[]): string {
  const qs = addresses.map((a) => `address=${encodeURIComponent(a)}`).join('&');
  return `${NFD_API_BASE}/nfd/lookup?${qs}&view=tiny`;
}

async function fetchLookup(
  fetchImpl: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
  } catch {
    return { kind: 'error' }; // network error / abort — state unknown
  }
  if (res.status === 404) return { kind: 'none' }; // confirmed: no NFD for the queried set
  if (!res.ok) return { kind: 'error' }; // 429 / 5xx — transient, unknown
  try {
    const json: unknown = await res.json();
    if (!json || typeof json !== 'object') return { kind: 'error' };
    return { kind: 'data', data: json as Record<string, RawNfd | undefined> };
  } catch {
    return { kind: 'error' }; // malformed body — treat as a transient failure, not a miss
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
