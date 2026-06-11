import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { FLIP_POINTS, TAP_CAP, goldenIndex, tapPoints } from './fairPoints.js';

// The formula is PUBLISHED (docs/design/fair-points-v1.md) — these tests pin its exact
// behavior so an accidental change shows up as a failure, not as silently rewritten points.

const SID = '6c1f3a52-9d4e-4b3a-8f21-0c9b7d5e1a23';

describe('goldenIndex', () => {
  it('matches the published derivation: uint32_be(sha256("fairtap:"+sid)) % 100 + 1', () => {
    const h = createHash('sha256').update(`fairtap:${SID}`).digest();
    expect(goldenIndex(SID)).toBe((h.readUInt32BE(0) % TAP_CAP) + 1);
  });

  it('is deterministic and within 1..TAP_CAP', () => {
    for (const sid of [SID, 'a', 'b', '00000000-0000-0000-0000-000000000000']) {
      const g = goldenIndex(sid);
      expect(g).toBe(goldenIndex(sid));
      expect(g).toBeGreaterThanOrEqual(1);
      expect(g).toBeLessThanOrEqual(TAP_CAP);
    }
  });

  it('differs across sessions (not a constant)', () => {
    const values = new Set(Array.from({ length: 50 }, (_, i) => goldenIndex(`session-${i}`)));
    expect(values.size).toBeGreaterThan(10);
  });
});

describe('tapPoints', () => {
  const g = goldenIndex(SID);

  it.each([
    { taps: 0, expected: 0 },
    { taps: g - 1, expected: g - 1 }, // one short of golden: no bonus
    { taps: g, expected: g + 9 }, // golden tap reached: that tap pays ×10
    { taps: TAP_CAP, expected: TAP_CAP + 9 }, // full run always includes the golden
    { taps: TAP_CAP + 500, expected: TAP_CAP + 9 }, // cap clamps over-reports
  ])('taps=$taps → $expected points', ({ taps, expected }) => {
    expect(tapPoints(SID, taps)).toBe(expected);
  });

  it('never exceeds TAP_CAP + 9 and never goes negative', () => {
    expect(tapPoints(SID, Number.MAX_SAFE_INTEGER)).toBe(TAP_CAP + 9);
    expect(tapPoints(SID, -5)).toBe(0);
  });

  it('is monotonic in taps (greatest() upsert relies on this)', () => {
    let prev = -1;
    for (let t = 0; t <= TAP_CAP + 5; t++) {
      const p = tapPoints(SID, t);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('constants', () => {
  it('pins the published economy: 100/flip, 100-tap cap', () => {
    expect(FLIP_POINTS).toBe(100);
    expect(TAP_CAP).toBe(100);
  });
});
