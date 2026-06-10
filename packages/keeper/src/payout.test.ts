import { describe, it, expect } from 'vitest';
import { computeNetPayout } from './payout.js';

describe('computeNetPayout', () => {
  // Verify the win multiplier is exact for the three bps values in production use.
  it.each([
    // [won, bet µA, houseEdgeBps, expected µA]
    [true, 100_000n, 300n, 194_000n], // 0.1 ALGO @ 3% → 0.194
    [true, 100_000n, 450n, 191_000n], // 0.1 ALGO @ 4.5% → 0.191
    [true, 100_000n, 500n, 190_000n], // 0.1 ALGO @ 5% → 0.190
    [false, 100_000n, 300n, 0n], // loss → 0 regardless of edge
    [false, 500_000n, 500n, 0n], // loss always 0
  ] as const)('won=%s bet=%s bps=%s → %s', (won, bet, bps, expected) => {
    expect(computeNetPayout(won, bet, bps)).toBe(expected);
  });

  // Stress the formula across multiple bet sizes and edge values.
  it.each([
    // [bet µA, houseEdgeBps, expected µA]
    [1_000_000n, 300n, 1_940_000n], // 1 ALGO @ 3%
    [1_000_000n, 450n, 1_910_000n], // 1 ALGO @ 4.5%
    [1_000_000n, 500n, 1_900_000n], // 1 ALGO @ 5%
    [500_000n, 300n, 970_000n], // 0.5 ALGO @ 3%
    [250_000n, 300n, 485_000n], // 0.25 ALGO @ 3%
    [20_000_000n, 300n, 38_800_000n], // 20 ALGO @ 3% (max-bet regression)
  ] as const)('win %s µA @ %s bps → %s', (bet, bps, expected) => {
    expect(computeNetPayout(true, bet, bps)).toBe(expected);
  });

  // mockRejected sibling: loss always pays 0 for any edge including edge cases.
  it.each([0n, 300n, 500n, 9999n, 10000n] as const)('loss pays 0 at %s bps', (bps) => {
    expect(computeNetPayout(false, 1_000_000n, bps)).toBe(0n);
  });

  it('0% edge → exact 2x return', () => {
    expect(computeNetPayout(true, 1_000_000n, 0n)).toBe(2_000_000n);
  });

  it('is exactly 1.94x at 300 bps — guards against constant drift', () => {
    const bet = 1_000_000n;
    expect(computeNetPayout(true, bet, 300n)).toBe(1_940_000n);
    expect(computeNetPayout(true, bet, 300n)).not.toBe(1_960_000n);
  });
});
