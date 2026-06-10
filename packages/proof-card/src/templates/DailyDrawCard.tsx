import React from 'react';
import type { DailyDrawCardData } from '@fairground/types';
import { colors, fonts } from '../theme.js';

interface Props {
  data: DailyDrawCardData;
  /** Data-URI of the QR PNG (points at https://app.fairground.quest/pot). */
  qr?: string;
  /** Data-URI of the minted-seal medallion. */
  seal?: string;
  /** Data-URI of the guilloché security-pattern background. */
  bg?: string;
}

const microToAlgo = (micro: bigint): string => {
  const algo = Number(micro) / 1_000_000;
  return algo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

const shortAddr = (addr: string): string => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-10)}`;

/**
 * Daily Pot draw proof card — 1600×900 amber-terminal layout.
 *
 * Left panel: hero pot (massive mono number) + rollover line.
 * Right panel: Proof-of-Fairness: winner badge, runners-up list, ticket count,
 * VRF round + beacon chip, QR to https://app.fairground.quest/pot.
 *
 * Satori constraints: every multi-child div has display:flex; no large box-shadow
 * blur (resvg Alpine Gaussian O(radius²) hangs); depth via raster bg + gradients.
 */
export function DailyDrawCard({ data, qr, seal, bg }: Props): React.ReactElement {
  const epochLabel = `DRAW #${data.epochId.toString()}`;
  const potAlgo = microToAlgo(data.potMicroalgo);
  const rolloverAlgo = microToAlgo(data.rolloverMicroalgo);
  const winnerLabel = data.winnerNfd ?? shortAddr(data.winnerAddress);
  const winnerAlgo = microToAlgo(data.winnerPayoutMicroalgo);

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
      {/* guilloché banknote field */}
      {bg && (
        <img
          src={bg}
          width={1600}
          height={900}
          style={{ position: 'absolute', top: 0, left: 0, opacity: 0.45 }}
        />
      )}
      {/* dim overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '1600px',
          height: '900px',
          background: 'rgba(17,12,8,0.30)',
        }}
      />
      {/* corner amber glow — top-left */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '700px',
          height: '600px',
          background: 'radial-gradient(circle at 25% 25%, rgba(212,150,58,0.14), transparent 65%)',
        }}
      />
      {/* corner amber glow — bottom-right */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '600px',
          height: '500px',
          background: 'radial-gradient(circle at 80% 80%, rgba(212,150,58,0.10), transparent 65%)',
        }}
      />

      {/* ---- Left panel: hero pot ---- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          width: '624px',
          height: '900px',
          background:
            'radial-gradient(circle at 50% 42%, rgba(212,150,58,0.18), rgba(11,6,5,0.55) 70%)',
          border: `3px solid rgba(212,150,58,0.48)`,
          gap: '10px',
          padding: '46px',
          position: 'relative',
        }}
      >
        {seal && (
          <img
            src={seal}
            width={280}
            height={280}
            style={{ position: 'absolute', top: '150px', left: '172px', opacity: 0.11 }}
          />
        )}

        {/* DAILY POT header label */}
        <div
          style={{
            display: 'flex',
            fontSize: '18px',
            fontWeight: 700,
            color: colors.textDim,
            letterSpacing: '5px',
          }}
        >
          DAILY POT
        </div>

        {/* epoch label */}
        <div
          style={{
            display: 'flex',
            fontSize: '28px',
            fontWeight: 700,
            color: colors.primary,
            letterSpacing: '3px',
            marginBottom: '4px',
          }}
        >
          {epochLabel}
        </div>

        {/* hero pot number */}
        <div
          style={{
            display: 'flex',
            fontSize: '118px',
            fontWeight: 700,
            color: colors.primary,
            letterSpacing: '-4px',
            lineHeight: '108px',
            textShadow: `0 0 22px rgba(212,150,58,0.55), 0 0 8px rgba(212,150,58,0.7)`,
          }}
        >
          {potAlgo}
        </div>

        {/* ALGO label */}
        <div
          style={{
            display: 'flex',
            fontSize: '26px',
            fontWeight: 700,
            color: colors.primary,
            letterSpacing: '8px',
            opacity: 0.85,
            marginTop: '4px',
          }}
        >
          ALGO POT
        </div>

        {/* rollover line */}
        <div
          style={{
            display: 'flex',
            marginTop: '18px',
            fontSize: '20px',
            color: colors.textDim,
            letterSpacing: '1px',
          }}
        >
          {`rollover → next pot: ${rolloverAlgo} ALGO`}
        </div>

        <div
          style={{
            display: 'flex',
            height: '1px',
            width: '220px',
            background: colors.borderAccent,
            marginTop: '24px',
          }}
        />
        <div
          style={{
            display: 'flex',
            fontSize: '24px',
            fontWeight: 700,
            color: colors.primary,
            marginTop: '12px',
            letterSpacing: '4px',
          }}
        >
          FAIRGROUND.QUEST
        </div>
      </div>

      {/* ---- Right panel: Proof-of-Fairness ---- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: '50px 60px',
          position: 'relative',
        }}
      >
        {/* amber accent top bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '976px',
            height: '4px',
            background: colors.primary,
            opacity: 0.65,
          }}
        />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div
            style={{ display: 'flex', fontSize: '48px', fontWeight: 700, letterSpacing: '-1px' }}
          >
            Proof of Fairness
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              marginTop: '6px',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '16px',
                color: colors.textDim,
                letterSpacing: '2px',
              }}
            >
              DAILY POT // {epochLabel}
            </div>
            <div
              style={{
                display: 'flex',
                marginTop: '4px',
                fontSize: '22px',
                fontWeight: 700,
                color: colors.textDim,
              }}
            >
              {data.timestamp.toISOString().slice(0, 10)}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            height: '2px',
            background: 'rgba(212,150,58,0.4)',
            margin: '24px 0',
          }}
        />

        {/* Main content: winner + runners + proof chip */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', flex: 1 }}>
          {/* Winner row */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '18px 22px',
              background: 'rgba(62,184,106,0.10)',
              border: '2px solid rgba(62,184,106,0.45)',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '16px',
                fontWeight: 700,
                color: colors.textDim,
                letterSpacing: '3px',
              }}
            >
              WINNER
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: '30px',
                  fontWeight: 700,
                  color: colors.green,
                }}
              >
                {winnerLabel}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: '34px',
                  fontWeight: 700,
                  color: colors.green,
                  letterSpacing: '-1px',
                }}
              >
                {`+${winnerAlgo} ALGO`}
              </div>
            </div>
          </div>

          {/* Runners-up list */}
          {data.runnersUp.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: '15px',
                  fontWeight: 700,
                  color: colors.textDim,
                  letterSpacing: '3px',
                }}
              >
                RUNNERS-UP
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {data.runnersUp.slice(0, 5).map((r, i) => {
                  const runnerLabel = r.nfd ?? shortAddr(r.address);
                  const payout = r.payoutMicroalgo;
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          fontSize: '20px',
                          color: colors.textDim,
                          opacity: 0.8,
                        }}
                      >
                        {`${i + 1}. ${runnerLabel}`}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          fontSize: '20px',
                          color: payout > 0n ? colors.textDim : colors.textMuted,
                        }}
                      >
                        {payout > 0n ? `+${microToAlgo(payout)} ALGO` : 'rolled over'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ticket count line */}
          <div
            style={{
              display: 'flex',
              fontSize: '18px',
              color: colors.textDim,
              letterSpacing: '1px',
            }}
          >
            {`${data.winnerTickets.toString()} winning ticket of ${data.totalTickets.toString()} total`}
          </div>

          {/* VRF round + beacon output chip */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              padding: '18px 22px',
              background: 'rgba(91,143,212,0.12)',
              border: `2px solid rgba(91,143,212,0.50)`,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '16px',
                fontWeight: 700,
                color: colors.vrfBlue,
                letterSpacing: '2px',
              }}
            >
              {`VRF RANDOMNESS · ROUND ${data.vrfRound.toString()}`}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '28px',
                fontWeight: 700,
                color: '#86b6ff',
                letterSpacing: '1px',
              }}
            >
              {shortHash(data.beaconOutput)}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            height: '1px',
            background: 'rgba(212,150,58,0.28)',
            margin: '18px 0',
          }}
        />

        {/* Bottom strip: QR code */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div
              style={{
                display: 'flex',
                fontSize: '22px',
                fontWeight: 700,
                color: colors.primary,
                letterSpacing: '3px',
              }}
            >
              SCAN TO VERIFY · PLAY · WIN
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '17px',
                color: colors.textDim,
                letterSpacing: '1px',
              }}
            >
              app.fairground.quest/pot
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
              <img src={qr} width={196} height={196} />
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                width: '216px',
                height: '216px',
                border: `2px solid ${colors.border}`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
