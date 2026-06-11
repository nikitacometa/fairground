import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * FAIR points formula — the published, auditable accounting for the coin clicker.
 * See docs/design/fair-points-v1.md. These constants are part of the public formula;
 * do not change them mid-season (totals are recomputed from raw counts on read, so a
 * change would silently rewrite history).
 */

/** Hard cap on counted taps per flip — display may keep counting, accrual stops here. */
export const TAP_CAP = 100;
/** Points for playing a flip to resolution (win or loss; refunds/failures earn 0). */
export const FLIP_POINTS = 100;
/** Server-side plausibility ceiling on tap rate; reported counts above it are clamped. */
export const TAP_RATE_PER_SEC = 15;
/** Grace window after resolve during which the client's final tap flush is still accepted. */
export const TAP_GRACE_MS = 2 * 60 * 1000;

/**
 * The single hidden golden-tap index for a flip, in 1..TAP_CAP. Deterministic from the
 * session UUID (server-generated at bet registration), so it is unpredictable before the
 * flip is committed yet verifiable by anyone afterwards. The client computes the same
 * value independently for the ×10 flash; this server-side value is the one that pays.
 */
export function goldenIndex(sessionId: string): number {
  const h = createHash('sha256').update(`fairtap:${sessionId}`).digest();
  return (h.readUInt32BE(0) % TAP_CAP) + 1;
}

/**
 * Points a final tap count converts to: the capped count, +9 bonus when the golden index
 * was reached (that tap pays ×10). A pure function of (sessionId, count) — no order or
 * timing dependence, so lost/replayed/merged tap batches can never change the result.
 */
export function tapPoints(sessionId: string, taps: number): number {
  const t = Math.max(0, Math.min(Math.floor(taps), TAP_CAP));
  return t + (t >= goldenIndex(sessionId) ? 9 : 0);
}

/**
 * Bettor-only write token for the taps endpoint. Session ids are publicly discoverable
 * (GET /games/:gameId/active/:address), so the id alone must not authorize writes — anyone
 * could pad a rival's tap count. The token is returned ONLY in the recordBet response,
 * which only the bettor's client receives; recovery via the localStorage record re-runs
 * recordBet (idempotent) and gets it again. Server-side derived (HMAC), so no schema change.
 */
export function tapWriteToken(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`taptoken:${sessionId}`).digest('hex').slice(0, 32);
}

/** Constant-time token check (length leak is fine — the length is public). */
export function tapTokenValid(sessionId: string, secret: string, token: string): boolean {
  const expected = Buffer.from(tapWriteToken(sessionId, secret));
  const got = Buffer.from(token);
  return got.length === expected.length && timingSafeEqual(expected, got);
}
