import React from 'react';
import type { ProofCardData } from '@fairground/types';
import { colors, fonts, outcomeColor, outcomeLabel, vrfProofColor } from '../theme.js';

interface Props {
  data: ProofCardData;
}

/**
 * VRF result proof card -- 1600x900 landscape for Twitter/X sharing.
 *
 * Rendered via satori (JSX -> SVG) then @resvg/resvg-js (SVG -> PNG).
 * All styles must be inline objects -- no CSS variables, no @keyframes.
 * Only flex layout is supported by satori (no grid, no position:absolute in some cases).
 */
export function VrfResultCard({ data }: Props): React.ReactElement {
  const oColor = outcomeColor(data.outcome);
  const oLabel = outcomeLabel(data.outcome);
  const vrfColor = vrfProofColor();
  const isWin = data.outcome !== 'tails';

  const microToAlgo = (micro: bigint): string => {
    const algo = Number(micro) / 1_000_000;
    return algo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  };

  const shortHash = (h: string): string => `${h.slice(0, 8)}...${h.slice(-8)}`;
  const shortTxn = (t: string): string => `${t.slice(0, 10)}...${t.slice(-10)}`;

  return (
    <div
      style={{
        display: 'flex',
        width: '1600px',
        height: '900px',
        background: colors.bg,
        fontFamily: fonts.mono,
        color: colors.text,
        position: 'relative',
      }}
    >
      {/* Left panel -- outcome */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          width: '640px',
          height: '900px',
          background: isWin ? colors.greenDim : colors.redDim,
          borderRight: `1px solid ${colors.border}`,
          gap: '24px',
        }}
      >
        {/* Coin graphic */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '180px',
            height: '180px',
            borderRadius: '90px',
            border: `4px solid ${oColor}`,
            background: `rgba(0,0,0,0.4)`,
            fontSize: '80px',
          }}
        >
          {isWin ? '⬤' : '○'}
        </div>

        <div
          style={{
            fontSize: '72px',
            fontWeight: 900,
            color: oColor,
            letterSpacing: '-2px',
          }}
        >
          {oLabel}
        </div>

        {isWin && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{ fontSize: '18px', color: colors.textMuted }}>payout</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: colors.text }}>
              {microToAlgo(data.netPayoutMicroalgo)} ALGO
            </div>
          </div>
        )}

        {/* Brand */}
        <div style={{ fontSize: '20px', color: colors.textMuted, marginTop: '16px' }}>
          fairground.xyz
        </div>
      </div>

      {/* Right panel -- VRF proof */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '56px 64px',
          flex: 1,
          gap: '28px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '14px', color: colors.textMuted, marginBottom: '6px' }}>
              COINFLIP
            </div>
            <div style={{ fontSize: '28px', fontWeight: 700 }}>
              VRF Proof of Fairness
            </div>
          </div>
          <div style={{ fontSize: '14px', color: colors.textMuted, textAlign: 'right' }}>
            <div>wallet</div>
            <div style={{ color: colors.text }}>{data.walletPrefix}...</div>
          </div>
        </div>

        <div style={{ display: 'flex', height: '1px', background: colors.border }} />

        {/* VRF data */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <ProofRow
            label="VRF Beacon Round"
            value={data.vrfRound.toString()}
            valueColor={vrfColor}
          />
          <ProofRow
            label="Beacon Output Hash (SHA-256)"
            value={shortHash(data.beaconOutputHash)}
            valueColor={vrfColor}
            mono
          />
          <ProofRow
            label="Transaction ID"
            value={shortTxn(data.txnId)}
            mono
          />
          <ProofRow
            label="Game"
            value={`${data.game.toUpperCase()} — Multiplier ${data.multiplier}x`}
          />
          <ProofRow
            label="Resolved At"
            value={data.timestamp.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'}
          />
        </div>

        <div style={{ display: 'flex', height: '1px', background: colors.border }} />

        {/* Verification note */}
        <div
          style={{
            fontSize: '14px',
            color: colors.textMuted,
            lineHeight: '1.6',
          }}
        >
          Outcome derived on-chain: SHA-256(beacon_output ++ salt_hash)[0] % 2
          {'\n'}
          Verify at: algoexplorer.io/tx/{data.txnId}
        </div>

        {/* VRF brand badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: colors.vrfBlueDim,
            border: `1px solid ${colors.vrfBlue}`,
            borderRadius: '6px',
            padding: '10px 16px',
            alignSelf: 'flex-start',
          }}
        >
          <div style={{ fontSize: '14px', color: vrfColor }}>
            Powered by Applied Blockchain VRF Beacon #{MAINNET_BEACON_APP_ID_DISPLAY}
          </div>
        </div>
      </div>
    </div>
  );
}

const MAINNET_BEACON_APP_ID_DISPLAY = '947957720';

interface ProofRowProps {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
}

function ProofRow({ label, value, valueColor, mono }: ProofRowProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontSize: '12px', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '1px' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: mono ? '15px' : '18px',
          color: valueColor ?? colors.text,
          fontFamily: mono ? fonts.mono : fonts.mono,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}
