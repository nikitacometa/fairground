/**
 * FAIR points — client-side mirror of the published formula (docs/design/fair-points-v1.md).
 * The server's copy (packages/api/src/lib/fairPoints.ts) is the one that pays; this one only
 * drives the in-flight UI: the ×10 golden flash and the banked-points line on the result screen.
 */

/** Hard cap on counted taps per flip — display keeps going, accrual stops here. */
export const TAP_CAP = 100;
/** Points for playing a flip to resolution (win or loss). */
export const FLIP_POINTS = 100;

/**
 * The flip's hidden golden-tap index (1..TAP_CAP):
 * uint32_be(sha256("fairtap:" + sessionId)[0..4]) % 100 + 1 — identical to the server.
 * Resolves to null when WebCrypto is unavailable (the golden still PAYS server-side;
 * only the live flash is skipped).
 */
export async function clientGoldenIndex(sessionId: string): Promise<number | null> {
  try {
    const data = new TextEncoder().encode(`fairtap:${sessionId}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return (new DataView(digest).getUint32(0, false) % TAP_CAP) + 1;
  } catch {
    return null;
  }
}

/** Banked tap points for a raw count: capped count +9 when the golden index was reached. */
export function bankedTapPoints(raw: number, golden: number | null): number {
  const t = Math.max(0, Math.min(raw, TAP_CAP));
  return t + (golden !== null && t >= golden ? 9 : 0);
}
