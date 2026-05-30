/**
 * ProofCardDemo — React island.
 *
 * Renders a static sample VRF proof card using the @fairground/proof-card
 * VrfResultCard component styled with inline CSS (matching the satori output).
 *
 * This is a pure display component — no API calls, no blockchain interaction.
 * Hydrates client:visible so it doesn't block the initial paint.
 */

import { VrfResultCard } from '@fairground/proof-card';
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

export default function ProofCardDemo() {
  return (
    <div
      style={{
        width: '100%',
        overflowX: 'auto',
        borderRadius: '8px',
        border: '1px solid var(--color-border)',
      }}
    >
      {/*
       * VrfResultCard renders inline-styled JSX for satori — it works in the
       * browser too, since all styles are inline objects.
       * Scale it down for the landing page preview using a CSS transform.
       */}
      <div
        style={{
          width: '800px',
          height: '450px',
          transformOrigin: 'top left',
          transform: 'scale(0.5)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ width: '1600px', height: '900px', transform: 'scale(0.5)', transformOrigin: 'top left' }}>
          <VrfResultCard data={SAMPLE_DATA} format="landscape" />
        </div>
      </div>
    </div>
  );
}
