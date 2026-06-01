/**
 * ProofCardDemo — React island.
 *
 * A self-contained visual mockup of a VRF proof card for the landing page.
 * It deliberately does NOT import @fairground/proof-card: that package pulls in
 * satori/@resvg/sharp (native, server-only) modules that cannot ship in a static
 * client bundle. The real proof card is generated server-side at
 * api.fairground.xyz/proof/:txnId; this is just a styled preview.
 *
 * Pure display component — no API calls, no blockchain interaction.
 */

import type { ProofCardData } from '@fairground/types';

const SAMPLE_DATA: ProofCardData = {
  game: 'coinflip',
  walletPrefix: 'ABCD1234',
  outcome: 'heads',
  multiplier: 1.96,
  vrfRound: 62_184_291n,
  beaconOutputHash: 'f3a9c2e1d0b7a6f5e4d3c2b1a09f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1',
  txnId: 'TXNID1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901',
  netPayoutMicroalgo: 980_000n,
  timestamp: new Date('2026-05-31T14:32:11Z'),
};

const mono = "'JetBrains Mono', ui-monospace, monospace";
const amber = 'oklch(0.78 0.18 65)';
const win = 'oklch(0.72 0.18 145)';
const dim = 'oklch(0.65 0.02 60)';
const text = 'oklch(0.96 0.01 80)';

function short(value: string, head: number, tail: number): string {
  return value.length > head + tail ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

export default function ProofCardDemo() {
  const won = SAMPLE_DATA.multiplier > 0;
  const algo = (Number(SAMPLE_DATA.netPayoutMicroalgo) / 1_000_000).toFixed(2);

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '520px',
        aspectRatio: '16 / 9',
        background: 'oklch(0.13 0.02 40)',
        border: '1px solid oklch(0.24 0.03 60)',
        borderRadius: '14px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: text,
        boxShadow: '0 20px 60px -20px oklch(0.78 0.18 65 / 0.25)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, letterSpacing: '0.18em', color: amber, fontSize: '13px' }}>
          FAIRGROUND
        </span>
        <span
          style={{
            fontFamily: mono,
            fontSize: '12px',
            color: win,
            border: `1px solid ${win}`,
            borderRadius: '999px',
            padding: '3px 10px',
          }}
        >
          {SAMPLE_DATA.outcome.toUpperCase()} · {won ? 'WON' : 'LOST'}
        </span>
      </div>

      <div>
        <div style={{ fontSize: 'clamp(28px, 7vw, 44px)', fontWeight: 700, color: win }}>
          +{algo} ALGO
        </div>
        <div style={{ color: dim, fontSize: '13px', marginTop: '2px' }}>
          {SAMPLE_DATA.multiplier}× · coinflip
        </div>
      </div>

      <div style={{ fontFamily: mono, fontSize: '11px', lineHeight: 1.7, color: dim }}>
        <div>
          <span style={{ color: 'oklch(0.70 0.12 240)' }}>VRF round</span>{' '}
          {SAMPLE_DATA.vrfRound.toString()}
        </div>
        <div>
          <span style={{ color: 'oklch(0.70 0.12 240)' }}>beacon</span>{' '}
          {short(SAMPLE_DATA.beaconOutputHash, 10, 6)}
        </div>
        <div>
          <span style={{ color: 'oklch(0.70 0.12 240)' }}>txn</span>{' '}
          {short(SAMPLE_DATA.txnId, 8, 6)}
        </div>
      </div>

      <div style={{ color: dim, fontSize: '11px', letterSpacing: '0.04em' }}>
        Provably fair on Algorand · verify on-chain
      </div>
    </div>
  );
}
