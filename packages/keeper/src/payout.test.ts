import { describe, it, expect } from 'vitest';
import { computeNetPayout } from './payout.js';

describe('computeNetPayout (must mirror the contract 1.94x / 3% edge)', () => {
  it('pays 1.94x the stake on a win', () => {
    // 0.1 ALGO bet → 0.194 ALGO (this is the exact value the chain paid; a regression here is
    // what made the proof card show 1.96x while the contract paid 1.94x).
    expect(computeNetPayout(true, 100_000n)).toBe(194_000n);
  });

  it('pays 0 on a loss', () => {
    expect(computeNetPayout(false, 100_000n)).toBe(0n);
  });

  it.each([
    [100_000n, 194_000n], // 0.1 → 0.194
    [500_000n, 970_000n], // 0.5 → 0.970
    [1_000_000n, 1_940_000n], // 1.0 → 1.940
    [250_000n, 485_000n], // 0.25 → 0.485
  ])('win on %s microALGO pays %s', (bet, expected) => {
    expect(computeNetPayout(true, bet)).toBe(expected);
  });

  it('is exactly 1.94x (not 1.96x) — guards against an edge-constant drift', () => {
    const bet = 1_000_000n;
    expect(computeNetPayout(true, bet)).toBe(1_940_000n);
    expect(computeNetPayout(true, bet)).not.toBe(1_960_000n);
  });
});
