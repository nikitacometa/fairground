import React from 'react';
import type { ProofCardData } from '@fairground/types';
import { colors, fonts } from '../theme.js';

interface Props {
  data: ProofCardData;
  /** Data-URI of the QR PNG (points at the referral play link). */
  qr?: string;
  /** Short referral code shown on the card and encoded in the QR. */
  refCode?: string;
}

const BEACON_ID = '1615566206';

// A domed, directionally-lit ASCII disc — the signature coin, frozen onto the card.
// Generated once at module load (server-side) so satori renders real monospace art.
function coinAscii(): string {
  const W = 24;
  const H = 13;
  const ramp = ' .:-=+*oc#%@';
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const nx = (x / (W - 1)) * 2 - 1;
      const ny = (y / (H - 1)) * 2 - 1;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) {
        row += ' ';
        continue;
      }
      const nz = Math.sqrt(1 - r2);
      const lum = nx * -0.35 + ny * -0.45 + nz * 0.9; // light from upper-left-front
      let ci = Math.round(((lum + 0.15) / 1.15) * (ramp.length - 1));
      if (ci < 0) ci = 0;
      if (ci > ramp.length - 1) ci = ramp.length - 1;
      row += ramp[ci];
    }
    rows.push(row);
  }
  return rows.join('\n');
}
const COIN_ART = coinAscii();

const microToAlgo = (micro: bigint): string => {
  const algo = Number(micro) / 1_000_000;
  return algo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};
const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-10)}`;
const shortTxn = (t: string): string => `${t.slice(0, 12)}…${t.slice(-12)}`;

/**
 * VRF proof card v2 — 1600x900 landscape for Twitter/X. Hero outcome on the left
 * (shaded ASCII coin + big number), the verifiable VRF proof on the right, and a
 * referral QR strip along the bottom so the card is a viral play-loop, not just a flex.
 *
 * Rendered via satori (JSX -> SVG) -> resvg (SVG -> PNG). All styles inline; every div
 * with more than one child sets display:flex (a satori requirement).
 */
export function VrfResultCard({ data, qr, refCode }: Props): React.ReactElement {
  const isWin = data.outcome !== 'tails';
  const oColor = isWin ? colors.green : colors.red;
  const oLabel =
    data.outcome === 'jackpot'
      ? 'JACKPOT'
      : data.outcome === 'heads'
        ? 'HEADS · WON'
        : 'TAILS · LOST';
  const code = refCode ?? 'PLAY00';

  return (
    <div
      style={{
        display: 'flex',
        width: '1600px',
        height: '900px',
        background: colors.bg,
        fontFamily: fonts.mono,
        color: colors.text,
      }}
    >
      {/* ---- Left: hero outcome ---- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          width: '600px',
          height: '900px',
          background: isWin ? colors.greenDim : colors.redDim,
          borderRight: `1px solid ${colors.border}`,
          gap: '20px',
          padding: '40px',
        }}
      >
        <div
          style={{
            display: 'flex',
            whiteSpace: 'pre',
            fontFamily: fonts.mono,
            fontSize: '24px',
            lineHeight: '21px',
            letterSpacing: '5px',
            color: oColor,
          }}
        >
          {COIN_ART}
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: '34px',
            fontWeight: 700,
            color: oColor,
            letterSpacing: '2px',
          }}
        >
          {oLabel}
        </div>

        {isWin ? (
          <div
            style={{
              display: 'flex',
              fontSize: '92px',
              fontWeight: 700,
              color: oColor,
              letterSpacing: '-3px',
              lineHeight: '92px',
            }}
          >
            {`+${microToAlgo(data.netPayoutMicroalgo)}`}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              fontSize: '72px',
              fontWeight: 700,
              color: oColor,
              letterSpacing: '-2px',
            }}
          >
            FAIR.
          </div>
        )}
        <div
          style={{ display: 'flex', fontSize: '22px', color: colors.textDim, letterSpacing: '1px' }}
        >
          {isWin ? 'ALGO' : 'Lost by math, not luck.'}
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: '20px',
            color: colors.textMuted,
            marginTop: '8px',
            letterSpacing: '2px',
          }}
        >
          FAIRGROUND.QUEST
        </div>
      </div>

      {/* ---- Right: VRF proof + referral strip ---- */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '52px 60px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: '14px',
                color: colors.textMuted,
                letterSpacing: '3px',
                marginBottom: '6px',
              }}
            >
              COINFLIP // FAIRGROUND
            </div>
            <div style={{ display: 'flex', fontSize: '30px', fontWeight: 700 }}>
              Proof of Fairness
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              fontSize: '14px',
              color: colors.textMuted,
            }}
          >
            <div style={{ display: 'flex' }}>WALLET</div>
            <div style={{ display: 'flex', color: colors.text }}>{`${data.walletPrefix}…`}</div>
          </div>
        </div>

        <div
          style={{ display: 'flex', height: '1px', background: colors.border, margin: '28px 0' }}
        />

        {/* VRF rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', flex: 1 }}>
          <ProofRow
            label="VRF Beacon Round"
            value={data.vrfRound.toString()}
            valueColor={colors.vrfBlue}
          />
          <ProofRow
            label="Beacon Output Hash (SHA-256)"
            value={shortHash(data.beaconOutputHash)}
            valueColor={colors.vrfBlue}
          />
          <ProofRow label="Transaction ID" value={shortTxn(data.txnId)} />
          <ProofRow label="Outcome Derivation" value="SHA-256(beacon ++ salt)[0] % 2" />
          <ProofRow
            label="Resolved"
            value={`${data.timestamp.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
          />
        </div>

        <div
          style={{ display: 'flex', height: '1px', background: colors.border, margin: '24px 0' }}
        />

        {/* Referral + QR strip */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div
              style={{
                display: 'flex',
                fontSize: '13px',
                color: colors.textMuted,
                letterSpacing: '2px',
              }}
            >
              SCAN TO PLAY · 4% OFF FEES
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ display: 'flex', fontSize: '15px', color: colors.textMuted }}>REF</div>
              <div
                style={{
                  display: 'flex',
                  fontSize: '22px',
                  fontWeight: 700,
                  color: colors.primary,
                  border: `1px solid ${colors.primary}`,
                  padding: '4px 14px',
                  letterSpacing: '3px',
                }}
              >
                {code}
              </div>
            </div>
            <div style={{ display: 'flex', fontSize: '13px', color: colors.vrfBlue }}>
              {`Verify on-chain · allo.info/tx/${data.txnId.slice(0, 8)}…`}
            </div>
            <div style={{ display: 'flex', fontSize: '12px', color: colors.textMuted }}>
              {`Applied Blockchain VRF Beacon #${BEACON_ID}`}
            </div>
          </div>

          {qr ? (
            <img
              src={qr}
              width={132}
              height={132}
              style={{ border: `1px solid ${colors.border}` }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                width: '132px',
                height: '132px',
                border: `1px solid ${colors.border}`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface ProofRowProps {
  label: string;
  value: string;
  valueColor?: string;
}

function ProofRow({ label, value, valueColor }: ProofRowProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div
        style={{ display: 'flex', fontSize: '12px', color: colors.textMuted, letterSpacing: '1px' }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ display: 'flex', fontSize: '18px', color: valueColor ?? colors.text }}>
        {value}
      </div>
    </div>
  );
}
