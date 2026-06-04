/**
 * Recover the VRF beacon output from a resolve() transaction.
 *
 * The coinflip contract's first inner transaction is the beacon `must_get()` app call. Its
 * ABI return value is emitted as a log: the 4-byte return prefix 0x151f7c75, then an ARC-4
 * `byte[]` (a 2-byte big-endian length 0x0020 = 32, then the 32 raw VRF bytes). Verified
 * against a live resolve txn (R5VUZJNZ…3K7Q) on 2026-06-04.
 *
 * The keeper used to drop this, so every proof card rendered a 64-zero beacon hash —
 * undermining the whole "verifiable by anyone" claim. Capturing it here lets proof.ts show
 * the real hash.
 */

const ABI_RETURN_PREFIX = '151f7c75';
const VRF_OUTPUT_BYTES = 32;

/** Minimal shape of an inner transaction confirmation that carries ABI return logs. */
export interface InnerTxnWithLogs {
  logs?: Uint8Array[];
}

/**
 * Scan a resolve() confirmation's inner transactions for the beacon's 32-byte VRF output.
 * Returns the lower-case hex (64 chars), or null if no matching return log is present
 * (e.g. a refund, or an unexpected group shape) so the caller can fall back gracefully.
 */
export function extractBeaconOutputHex(
  innerTxns: ReadonlyArray<InnerTxnWithLogs> | undefined,
): string | null {
  const lenPrefixHex = VRF_OUTPUT_BYTES.toString(16).padStart(4, '0'); // '0020'
  for (const inner of innerTxns ?? []) {
    for (const log of inner.logs ?? []) {
      const hex = Buffer.from(log).toString('hex');
      if (!hex.startsWith(ABI_RETURN_PREFIX)) continue;
      const body = hex.slice(ABI_RETURN_PREFIX.length);
      if (body.slice(0, 4) !== lenPrefixHex) continue;
      const value = body.slice(4, 4 + VRF_OUTPUT_BYTES * 2);
      if (value.length === VRF_OUTPUT_BYTES * 2) return value;
    }
  }
  return null;
}
