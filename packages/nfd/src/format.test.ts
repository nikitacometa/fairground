import { describe, it, expect } from 'vitest';
import { truncateAddress, nfdLabel } from './format.js';

const ADDR = 'R2BPRCZNWG6NZPZFZP36DBSDPKSGUFMWVBHHBHOLZR65X2E5ZZLC4PHSSQ';

describe('truncateAddress', () => {
  it.each([
    [ADDR, 'R2BPRC…HSSQ'],
    ['ABCDEFGHIJKLMNOP', 'ABCDEF…MNOP'],
  ])('middle-truncates with the default 6+4 window', (input, expected) => {
    expect(truncateAddress(input)).toBe(expected);
  });

  it('returns the empty string for empty input', () => {
    expect(truncateAddress('')).toBe('');
  });

  it('returns a short string unchanged (no truncation needed)', () => {
    expect(truncateAddress('ABCDEFGHIJ')).toBe('ABCDEFGHIJ');
  });

  it('respects a custom head/tail window', () => {
    expect(truncateAddress('ABCDEFGHIJKL', 3, 2)).toBe('ABC…KL');
  });

  it('uses the Unicode ellipsis, never three ASCII dots', () => {
    const out = truncateAddress(ADDR);
    expect(out).toContain('…');
    expect(out).not.toContain('...');
  });
});

describe('nfdLabel', () => {
  it('returns the NFD name when a record is present', () => {
    expect(nfdLabel({ name: 'goanna.algo', address: ADDR, verified: true }, ADDR)).toBe(
      'goanna.algo',
    );
  });

  it('falls back to the truncated address when the record is null', () => {
    expect(nfdLabel(null, ADDR)).toBe('R2BPRC…HSSQ');
  });

  it('falls back to the truncated address when the record is undefined', () => {
    expect(nfdLabel(undefined, ADDR)).toBe(truncateAddress(ADDR));
  });
});
