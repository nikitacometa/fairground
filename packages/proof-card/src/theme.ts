// Fairground visual identity -- hardcoded hex values (satori has no CSS variable support)
// OKLCH source:
//   bg:      oklch(0.10 0.02 30)   -> #1a100a
//   primary: oklch(0.78 0.18 65)   -> #d4963a
//   green:   oklch(0.72 0.18 145)  -> #3eb86a
//   red:     oklch(0.58 0.20 25)   -> #c43030
//   vrf:     oklch(0.70 0.12 240)  -> #5b8fd4

export const colors = {
  bg: '#110c08',
  bgSurface: '#1a100a',
  bgElevated: '#241407',
  border: '#2e1a0e',
  borderAccent: '#3d2210',
  text: '#f0e8d8',
  textDim: '#a0856a',
  textMuted: '#5a3a20',
  primary: '#d4963a',
  primaryDim: 'rgba(212,150,58,0.15)',
  primaryGlow: 'rgba(212,150,58,0.35)',
  green: '#3eb86a',
  greenDim: 'rgba(62,184,106,0.12)',
  red: '#c43030',
  redDim: 'rgba(196,48,48,0.12)',
  vrfBlue: '#5b8fd4',
  vrfBlueDim: 'rgba(91,143,212,0.15)',
  overlay: 'rgba(17,12,8,0.90)',
  overlayLight: 'rgba(17,12,8,0.75)',
  borderFrame: 'rgba(212,150,58,0.5)',
} as const;

export const fonts = {
  mono: 'IBM Plex Mono',
  sans: 'Geist',
} as const;

export const sizes = {
  card: { width: 1600, height: 900 },    // Twitter/X landscape
  square: { width: 1200, height: 1200 }, // Instagram square
} as const;

/** Card aspect format. 'landscape' -> sizes.card, 'square' -> sizes.square. */
export type CardFormat = 'landscape' | 'square';

export type FlipOutcome = 'heads' | 'tails' | 'jackpot';

export function outcomeColor(outcome: FlipOutcome): string {
  switch (outcome) {
    case 'heads': return colors.green;
    case 'jackpot': return colors.primary;
    case 'tails': return colors.red;
  }
}

export function outcomeLabel(outcome: FlipOutcome): string {
  switch (outcome) {
    case 'heads': return 'HEADS';
    case 'jackpot': return 'JACKPOT';
    case 'tails': return 'TAILS';
  }
}

export function vrfProofColor(): string {
  return colors.vrfBlue;
}
