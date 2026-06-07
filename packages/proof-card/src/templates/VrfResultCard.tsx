import React from 'react';
import type { ProofCardData } from '@fairground/types';
import { colors, fonts } from '../theme.js';

interface Props {
  data: ProofCardData;
  /** Data-URI of the QR PNG (points at the referral play link). */
  qr?: string;
  /** Short referral code shown on the card and encoded in the QR. */
  refCode?: string;
  /** Data-URI of the minted-seal medallion (authenticity stamp behind the hero). */
  seal?: string;
  /** Data-URI of the guilloché security-pattern background (banknote depth). */
  bg?: string;
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
const shortHash = (h: string): string => `${h.slice(0, 12)}…${h.slice(-12)}`;
const shortTxn = (t: string): string => `${t.slice(0, 14)}…${t.slice(-14)}`;

/**
 * VRF proof card v3 — "Minted Certificate of Fairness". 1600x900 landscape for Twitter/X.
 *
 * Layout: a guilloché banknote field for depth, corner phosphor glow, a left hero panel (shaded
 * ASCII coin + a huge glowing payout number + authenticity seal) and a right proof ledger where the
 * beacon output — the one datum that proves fairness — is elevated into its own chip. A large QR
 * (scannable from a tweet preview) closes the viral play-loop.
 *
 * Rendered via satori (JSX -> SVG) -> resvg (SVG -> PNG). All styles inline; every div with more
 * than one child sets display:flex (a satori requirement). Glow uses SMALL textShadow (<=22px) and
 * radial-gradient layers, never large box-shadow blur: resvg on Alpine renders a Gaussian-blur
 * kernel in O(radius^2) and a 130px shadow alone took ~4.7s in the api container (a 260px one hung
 * the process). Depth comes from the raster guilloché bg + gradients, not blur.
 */
export function VrfResultCard({ data, qr, refCode, seal, bg }: Props): React.ReactElement {
  const isWin = data.outcome !== 'tails';
  const oColor = isWin ? colors.green : colors.red;
  const glow = isWin ? 'rgba(62,184,106,0.55)' : 'rgba(196,48,48,0.5)';
  // The player's actual call drives the side label. Pre-M1 bets have no recorded pick, so
  // the card shows a plain WON/LOST rather than asserting a side it does not know.
  const sidePrefix = data.playerPick ? `${data.playerPick.toUpperCase()} · ` : '';
  const oLabel =
    data.outcome === 'jackpot' ? 'JACKPOT' : isWin ? `${sidePrefix}WON` : `${sidePrefix}LOST`;
  const code = refCode ?? 'PLAY00';

  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: '1600px',
        height: '900px',
        background: colors.bg,
        fontFamily: fonts.mono,
        color: colors.text,
      }}
    >
      {/* guilloché banknote field for depth */}
      {bg && (
        <img
          src={bg}
          width={1600}
          height={900}
          style={{ position: 'absolute', top: 0, left: 0, opacity: 0.55 }}
        />
      )}
      {/* dim wash so the data stays legible over the pattern */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '1600px',
          height: '900px',
          background: 'rgba(17,12,8,0.25)',
        }}
      />
      {/* corner phosphor — soft light via radial-gradients (NOT box-shadow blur: resvg on Alpine
          chokes on large Gaussian-blur kernels and hangs the process). Gradients render instantly. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '700px',
          height: '600px',
          background: `radial-gradient(circle at 30% 30%, ${isWin ? 'rgba(62,184,106,0.13)' : 'rgba(196,48,48,0.12)'}, transparent 65%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '600px',
          height: '500px',
          background: 'radial-gradient(circle at 75% 75%, rgba(212,150,58,0.1), transparent 65%)',
        }}
      />

      {/* ---- Left: hero outcome. Win = green-lit & warm; loss = dark crimson. The two must be
           tellable apart at muted thumbnail brightness, so loss darkens the amber guilloché and
           rings the panel crimson, win rings it green with an inset bloom. ---- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          width: '624px',
          height: '900px',
          background: isWin
            ? 'radial-gradient(circle at 50% 42%, rgba(62,184,106,0.16), rgba(62,184,106,0.05) 70%)'
            : 'radial-gradient(circle at 50% 42%, rgba(150,26,26,0.22), rgba(11,6,5,0.55) 70%)',
          border: `3px solid ${isWin ? 'rgba(62,184,106,0.5)' : 'rgba(196,48,48,0.46)'}`,
          gap: '12px',
          padding: '46px',
          position: 'relative',
        }}
      >
        {/* minted authenticity seal — subordinate relief strictly behind the coin */}
        {seal && (
          <img
            src={seal}
            width={300}
            height={300}
            style={{ position: 'absolute', top: '150px', left: '162px', opacity: 0.13 }}
          />
        )}

        <div
          style={{
            display: 'flex',
            whiteSpace: 'pre',
            fontFamily: fonts.mono,
            fontSize: '12px',
            lineHeight: '10px',
            letterSpacing: '3px',
            color: oColor,
            opacity: 0.85,
            textShadow: `0 0 16px ${glow}`,
          }}
        >
          {COIN_ART}
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: '30px',
            fontWeight: 700,
            color: oColor,
            letterSpacing: '4px',
            marginTop: '14px',
          }}
        >
          {oLabel}
        </div>

        {/* Hero = the amount, always. Win shows the payout; loss shows the stake lost. The number
            dominates first-fixation; the brand quip ("FAIR.") is demoted to a tagline beneath it. */}
        {isWin ? (
          <div
            style={{
              display: 'flex',
              fontSize: '138px',
              fontWeight: 700,
              color: colors.green,
              letterSpacing: '-5px',
              lineHeight: '128px',
              textShadow: `0 0 22px ${glow}, 0 0 8px rgba(62,184,106,0.7)`,
            }}
          >
            {`+${microToAlgo(data.netPayoutMicroalgo)}`}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              fontSize: '114px',
              fontWeight: 700,
              color: colors.red,
              letterSpacing: '-4px',
              lineHeight: '106px',
              textShadow: `0 0 20px ${glow}, 0 0 8px rgba(196,48,48,0.6)`,
            }}
          >
            {data.stakeMicroalgo != null ? `−${microToAlgo(data.stakeMicroalgo)}` : '—'}
          </div>
        )}

        {isWin ? (
          <div
            style={{
              display: 'flex',
              fontSize: '22px',
              color: colors.green,
              letterSpacing: '8px',
              opacity: 0.85,
            }}
          >
            ALGO PAID
          </div>
        ) : (
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '36px',
                fontWeight: 700,
                color: colors.red,
                letterSpacing: '2px',
                opacity: 0.92,
              }}
            >
              ALGO · FAIR.
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '18px',
                color: colors.textDim,
                letterSpacing: '1px',
              }}
            >
              Lost by math, not luck.
            </div>
          </div>
        )}

        {data.streak != null && data.streak >= 3 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: '12px',
              padding: '7px 20px',
              border: `2px solid ${colors.primary}`,
              background: colors.primaryDim,
              color: colors.primary,
              fontSize: '22px',
              fontWeight: 700,
              letterSpacing: '3px',
            }}
          >
            {`WIN STREAK ×${data.streak}`}
          </div>
        )}

        {/* trust micro-stamp — turns the dead zone into a proof signal the left panel can stand on alone */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '20px',
            fontSize: '13px',
            color: colors.vrfBlue,
            letterSpacing: '2px',
          }}
        >
          {`✓ VRF ROUND ${data.vrfRound.toString()} · CERTIFIED`}
        </div>
        <div
          style={{
            display: 'flex',
            height: '1px',
            width: '200px',
            background: colors.borderAccent,
            marginTop: '6px',
          }}
        />
        <div
          style={{
            display: 'flex',
            fontSize: '22px',
            fontWeight: 700,
            color: colors.primary,
            marginTop: '8px',
            letterSpacing: '4px',
          }}
        >
          FAIRGROUND.QUEST
        </div>
      </div>

      {/* ---- Right: VRF proof ledger + referral strip. Carries the win/loss color so the two
           outcomes are distinct even on the proof side at thumbnail. ---- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: '50px 60px',
          position: 'relative',
        }}
      >
        {/* outcome-tinted top accent + corner glow */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '976px',
            height: '4px',
            background: oColor,
            opacity: 0.65,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '460px',
            height: '420px',
            background: `radial-gradient(circle at 80% 20%, ${isWin ? 'rgba(62,184,106,0.09)' : 'rgba(196,48,48,0.09)'}, transparent 65%)`,
          }}
        />
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: '14px',
                color: colors.primary,
                letterSpacing: '4px',
                marginBottom: '8px',
                opacity: 0.8,
              }}
            >
              COINFLIP // FAIRGROUND
            </div>
            <div
              style={{ display: 'flex', fontSize: '36px', fontWeight: 700, letterSpacing: '-1px' }}
            >
              Proof of Fairness
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              fontSize: '14px',
              color: colors.textDim,
            }}
          >
            <div style={{ display: 'flex', letterSpacing: '2px' }}>WALLET</div>
            <div
              style={{
                display: 'flex',
                marginTop: '4px',
                fontSize: '18px',
                color: data.walletNfd ? colors.primary : colors.text,
              }}
            >
              {data.walletNfd ?? `${data.walletPrefix}…`}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            height: '1px',
            background: isWin ? 'rgba(62,184,106,0.3)' : 'rgba(196,48,48,0.3)',
            margin: '26px 0',
          }}
        />

        {/* VRF ledger — the beacon output is elevated into its own chip */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
          <div style={{ display: 'flex', gap: '40px' }}>
            <ProofRow
              label="VRF Beacon Round"
              value={data.vrfRound.toString()}
              valueColor={colors.vrfBlue}
            />
            <ProofRow
              label="Resolved"
              value={`${data.timestamp.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
            />
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '16px 20px',
              background: colors.vrfBlueDim,
              border: `1px solid rgba(91,143,212,0.35)`,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '12px',
                color: colors.vrfBlue,
                letterSpacing: '2px',
              }}
            >
              VRF BEACON OUTPUT · THE SOURCE OF RANDOMNESS
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '21px',
                fontWeight: 700,
                color: colors.vrfBlue,
                letterSpacing: '1px',
              }}
            >
              {shortHash(data.beaconOutput)}
            </div>
          </div>

          <ProofRow label="Transaction ID" value={shortTxn(data.txnId)} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                display: 'flex',
                fontSize: '12px',
                color: colors.textDim,
                letterSpacing: '1px',
              }}
            >
              OUTCOME DERIVATION
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '18px',
                color: colors.text,
                background: colors.bgElevated,
                border: `1px solid ${colors.border}`,
                padding: '8px 14px',
              }}
            >
              sha256(beacon ++ salt)[0] % 2 = {isWin ? '1 → WIN' : '0 → LOSS'}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            height: '1px',
            background: isWin ? 'rgba(62,184,106,0.3)' : 'rgba(196,48,48,0.3)',
            margin: '22px 0',
          }}
        />

        {/* Referral + QR strip */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div
              style={{
                display: 'flex',
                fontSize: '15px',
                color: colors.primary,
                letterSpacing: '3px',
                fontWeight: 700,
              }}
            >
              SCAN TO PLAY · EARN 1% ON EVERY REFERRED FLIP
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: '15px',
                  color: colors.textDim,
                  letterSpacing: '1px',
                }}
              >
                REF
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: '24px',
                  fontWeight: 700,
                  color: colors.primary,
                  border: `1px solid ${colors.primary}`,
                  background: colors.primaryDim,
                  padding: '6px 18px',
                  letterSpacing: '4px',
                }}
              >
                {code}
              </div>
            </div>
            <div style={{ display: 'flex', fontSize: '14px', color: colors.vrfBlue }}>
              {`Verify on-chain · allo.info/tx/${data.txnId.slice(0, 8)}…`}
            </div>
            <div style={{ display: 'flex', fontSize: '12px', color: colors.textMuted }}>
              {`Applied Blockchain VRF Beacon #${BEACON_ID}`}
            </div>
          </div>

          {qr ? (
            <div
              style={{
                display: 'flex',
                padding: '10px',
                background: '#0b0805',
                border: `2px solid ${colors.primary}`,
              }}
            >
              <img src={qr} width={206} height={206} />
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                width: '226px',
                height: '226px',
                border: `2px solid ${colors.border}`,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <div
        style={{ display: 'flex', fontSize: '12px', color: colors.textDim, letterSpacing: '1px' }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ display: 'flex', fontSize: '18px', color: valueColor ?? colors.text }}>
        {value}
      </div>
    </div>
  );
}
