/**
 * ProofCardDemo — React island. A self-contained visual mockup of the VRF proof card,
 * laid out to MATCH the real satori-rendered card (api.fairground.quest/proof/:txnId):
 * a hero panel (ASCII coin + big payout) on the left, the verifiable VRF proof + referral
 * code on the right. It does NOT import @fairground/proof-card (that pulls in
 * satori/@resvg/sharp, server-only). Pure display — no API calls.
 */
import type { CSSProperties } from 'react';
import type { ProofCardData } from '@fairground/types';

const SAMPLE_DATA: ProofCardData = {
  game: 'coinflip',
  walletPrefix: 'METAFG12',
  outcome: 'heads',
  multiplier: 1.96,
  vrfRound: 62_184_291n,
  beaconOutputHash: 'f3a9c2e1d0b7a6f5e4d3c2b1a09f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1',
  txnId: 'R5VUZJNZEZMMPTGHD6E2NZO3KSJWHP4W4Z3ZPFD4PJD4QVSR3K7Q',
  netPayoutMicroalgo: 980_000n,
  timestamp: new Date('2026-05-31T14:32:11Z'),
};

// A shaded ASCII disc — same look as the satori card's generated coin.
const COIN = `      .:-==-:.
   .=+*##%%##*+=.
  +*#%@@@@@@@%#*+
 -#%@@@@@@@@@@@%#-
.+%@@@@@@@@@@@@@%+.
=*%@@@@@@@@@@@@@%*=
+#@@@@@@@@@@@@@@@#+
=*%@@@@@@@@@@@@@%*=
.+%@@@@@@@@@@@@@%+.
 -#%@@@@@@@@@@@%#-
  +*#%@@@@@@@%#*+
   .=+*##%%##*+=.
      .:-==-:.`;

const C = {
  bg: '#110c08',
  green: '#3eb86a',
  red: '#c43030',
  text: '#f0e8d8',
  textDim: '#a0856a',
  textMuted: '#5a3a20',
  vrf: '#5b8fd4',
  amber: '#d4963a',
  border: '#2e1a0e',
};

function short(v: string, head: number, tail: number): string {
  return v.length > head + tail ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div
        style={{
          fontSize: '8px',
          color: C.textMuted,
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '12px', color: color ?? C.text, wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  );
}

const panel: CSSProperties = { fontFamily: 'var(--font-mono)' };

export default function ProofCardDemo() {
  const d = SAMPLE_DATA;
  const isWin = d.outcome !== 'tails';
  const oColor = isWin ? C.green : C.red;
  const algo = (Number(d.netPayoutMicroalgo) / 1_000_000).toFixed(3);
  const ref = d.walletPrefix.slice(0, 6).toUpperCase();

  return (
    <div
      style={{
        ...panel,
        display: 'flex',
        width: '100%',
        maxWidth: '660px',
        aspectRatio: '16 / 9',
        background: C.bg,
        borderLeft: `2px solid ${C.amber}`,
        borderTop: `1px solid ${C.border}`,
        borderRight: `1px solid ${C.border}`,
        borderBottom: `1px solid ${C.border}`,
        color: C.text,
        overflow: 'hidden',
      }}
    >
      {/* Hero */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          width: '38%',
          background: isWin ? 'rgba(62,184,106,0.1)' : 'rgba(196,48,48,0.1)',
          borderRight: `1px solid ${C.border}`,
          gap: '6px',
          padding: '12px',
        }}
      >
        <pre
          style={{
            margin: 0,
            fontSize: '6px',
            lineHeight: '6px',
            letterSpacing: '1px',
            color: oColor,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {COIN}
        </pre>
        <div style={{ fontSize: '12px', fontWeight: 700, color: oColor, letterSpacing: '1px' }}>
          {isWin ? 'HEADS · WON' : 'TAILS · LOST'}
        </div>
        <div
          style={{
            fontSize: '34px',
            fontWeight: 700,
            color: oColor,
            letterSpacing: '-1px',
            lineHeight: 1,
          }}
        >
          +{algo}
        </div>
        <div style={{ fontSize: '10px', color: C.textDim }}>ALGO</div>
        <div
          style={{ fontSize: '9px', color: C.textMuted, letterSpacing: '2px', marginTop: '4px' }}
        >
          FAIRGROUND.QUEST
        </div>
      </div>

      {/* Proof */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: '18px 20px',
          gap: '11px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '9px', color: C.textMuted, letterSpacing: '2px' }}>
            COINFLIP // FAIRGROUND
          </div>
          <div style={{ fontSize: '15px', fontWeight: 700 }}>Proof of Fairness</div>
        </div>
        <div style={{ height: '1px', background: C.border }} />
        <Row label="VRF Beacon Round" value={d.vrfRound.toString()} color={C.vrf} />
        <Row label="Beacon Hash (SHA-256)" value={short(d.beaconOutputHash, 8, 8)} color={C.vrf} />
        <Row label="Transaction ID" value={short(d.txnId, 8, 8)} />
        <Row label="Derivation" value="SHA-256(beacon ++ salt)[0] % 2" />
        <div style={{ height: '1px', background: C.border, marginTop: 'auto' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '9px', color: C.textMuted }}>REF</span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: C.amber,
              border: `1px solid ${C.amber}`,
              padding: '2px 8px',
              letterSpacing: '2px',
            }}
          >
            {ref}
          </span>
          <span style={{ fontSize: '9px', color: C.vrf, marginLeft: 'auto' }}>
            SCAN TO PLAY · PROVABLY FAIR
          </span>
        </div>
      </div>
    </div>
  );
}
