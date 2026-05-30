/**
 * Vestige price batching queue with circuit breaker.
 *
 * Ported from cometa/metafarm-frontend/src/providers/coinPriceProvider.ts.
 * Replaced axios with fetch. Typed with bigint-safe number (prices are floats, not microALGO).
 *
 * 250ms debounce before flush. 25-asset chunks per request.
 * Circuit breaker: 5 consecutive failures -> 30s cooldown.
 */

const VESTIGE_BASE = 'https://api.vestigelabs.org';
const BATCH_DELAY_MS = 250;
const MAX_BATCH_SIZE = 25;
const MAX_FAILURES = 5;
const CIRCUIT_OPEN_MS = 30_000;

// Circuit breaker state (module-level singleton)
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function isCircuitOpen(): boolean {
  if (consecutiveFailures < MAX_FAILURES) return false;
  if (Date.now() > circuitOpenUntil) {
    consecutiveFailures = MAX_FAILURES - 1;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= MAX_FAILURES) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    console.warn(`[price-client] Vestige circuit breaker OPEN for ${CIRCUIT_OPEN_MS / 1000}s`);
  }
}

export interface VestigePriceResult {
  assetId: number;
  price: number;        // price in terms of denominatingAssetId
  confidence: number;
}

interface VestigeResponse {
  asset_id: number;
  denominating_asset_id: number;
  price: number;
  confidence: number;
}

interface BatchEntry {
  assetId: number;
  denominatingAssetId: number;
  resolve: (result: VestigePriceResult | null) => void;
}

const batchQueue: BatchEntry[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

async function flushBatch(): Promise<void> {
  batchTimer = null;
  if (flushing || batchQueue.length === 0) return;
  flushing = true;

  const groups = new Map<number, BatchEntry[]>();
  while (batchQueue.length > 0) {
    const entry = batchQueue.shift()!;
    const key = entry.denominatingAssetId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  try {
    for (const [denomId, entries] of groups) {
      if (isCircuitOpen()) {
        for (const entry of entries) entry.resolve(null);
        continue;
      }

      for (let i = 0; i < entries.length; i += MAX_BATCH_SIZE) {
        const chunk = entries.slice(i, i + MAX_BATCH_SIZE);
        const assetIds = chunk.map((e) => e.assetId).join(',');
        const url = `${VESTIGE_BASE}/assets/price?asset_ids=${assetIds}&network_id=0&denominating_asset_id=${denomId}`;

        try {
          const res = await fetch(url);
          if (!res.ok) {
            if (res.status === 429) {
              console.warn(`[price-client] Vestige 429 rate limit on ${chunk.length} assets`);
            }
            recordFailure();
            for (const entry of chunk) entry.resolve(null);
            continue;
          }
          recordSuccess();

          const data = (await res.json()) as VestigeResponse[];
          const priceMap = new Map<number, VestigePriceResult>();
          for (const item of data) {
            priceMap.set(item.asset_id, {
              assetId: item.asset_id,
              price: item.price,
              confidence: item.confidence,
            });
          }
          for (const entry of chunk) {
            entry.resolve(priceMap.get(entry.assetId) ?? null);
          }
        } catch (err) {
          recordFailure();
          console.error('[price-client] Vestige fetch error:', err);
          for (const entry of chunk) entry.resolve(null);
        }
      }
    }
  } finally {
    flushing = false;
    if (batchQueue.length > 0) scheduleBatch();
  }
}

function scheduleBatch(): void {
  if (batchTimer !== null) return;
  const delay = batchQueue.length >= MAX_BATCH_SIZE ? 0 : BATCH_DELAY_MS;
  batchTimer = setTimeout(() => void flushBatch(), delay);
}

function enqueue(assetId: number, denominatingAssetId: number): Promise<VestigePriceResult | null> {
  if (isCircuitOpen()) return Promise.resolve(null);
  return new Promise<VestigePriceResult | null>((resolve) => {
    batchQueue.push({ assetId, denominatingAssetId, resolve });
    scheduleBatch();
  });
}

/**
 * Get ALGO/USD price. ALGO asset ID is 0; USDC on Algorand is 31566704.
 * Returns price in USD (i.e., 1 ALGO = N USD).
 */
export async function getAlgoPrice(): Promise<number | null> {
  // Vestige quotes ALGO (0) vs USDC (31566704) as: price of USDC in ALGO terms
  // So ALGO/USD = 1 / price
  const result = await enqueue(31_566_704, 0);
  if (!result) return null;
  return 1 / result.price;
}

/**
 * Get price of an ASA in ALGO terms.
 *
 * @param assetId            - Algorand Standard Asset ID
 * @param denominatingAssetId - 0 for ALGO, 31566704 for USDC
 */
export async function getAssetPrice(
  assetId: number,
  denominatingAssetId = 0,
): Promise<VestigePriceResult | null> {
  return enqueue(assetId, denominatingAssetId);
}

/**
 * Get prices for multiple ASAs in one batched call.
 */
export async function getAssetPriceBatch(
  assetIds: number[],
  denominatingAssetId = 0,
): Promise<Map<number, VestigePriceResult | null>> {
  const results = await Promise.all(
    assetIds.map((id) => enqueue(id, denominatingAssetId).then((r) => [id, r] as const)),
  );
  return new Map(results);
}
