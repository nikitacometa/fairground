'use client';

/**
 * DrawBanner — a single dim line below the PotBar on the play page when the most recent
 * draw happened within the last 24 hours.
 *
 * "yesterday's pot: X ALGO → winner.algo · verify ↗"
 *
 * Links to the draw proof card ({API}/proof/draw/{epoch}).
 * Dismissible: once closed it writes a key to sessionStorage and stays hidden for the
 * session so it never re-appears while the user is playing.
 * Renders null when not configured or no recent draw.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { usePotState } from './usePotState';
import { truncateAddress } from '@fairground/nfd';

const SESSION_KEY = 'fg_draw_banner_dismissed';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function fmtAlgo(micro: string): string {
  const m = BigInt(micro);
  const whole = m / 1_000_000n;
  const frac = (m % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${frac}`;
}

function isWithin24h(drawnAt: string | null): boolean {
  if (!drawnAt) return false;
  return Date.now() - Date.parse(drawnAt) < ONE_DAY_MS;
}

export function DrawBanner(): ReactElement | null {
  const potState = usePotState(null);
  const [dismissed, setDismissed] = useState(true); // start dismissed to avoid flash
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(sessionStorage.getItem(SESSION_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!mounted) return null;
  if (dismissed) return null;
  if (!potState || !potState.configured) return null;

  const { lastDraw } = potState.data;
  if (!lastDraw || !isWithin24h(lastDraw.drawnAt)) return null;

  const apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? '';
  const proofUrl = `${apiBase}/proof/draw/${lastDraw.epochId}`;
  const winner = lastDraw.winner;
  const winnerLabel = winner ? (winner.nfd ?? truncateAddress(winner.address)) : null;

  const handleDismiss = (): void => {
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // private mode — dismiss is just in-memory
    }
    setDismissed(true);
  };

  return (
    <div
      className="flex w-full max-w-lg items-center justify-between gap-3 border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em]"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-text-muted)',
      }}
    >
      <span className="truncate">
        yesterday&apos;s pot:{' '}
        <span className="tabular-nums" style={{ color: 'var(--color-text-dim)' }}>
          {fmtAlgo(lastDraw.potMicroalgo)} ALGO
        </span>
        {winnerLabel && (
          <>
            {' → '}
            <span style={{ color: 'var(--color-primary)' }}>{winnerLabel}</span>
          </>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-3">
        <a
          href={proofUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-vrf)' }}
        >
          verify ↗
        </a>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss draw banner"
          className="transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
        >
          ×
        </button>
      </span>
    </div>
  );
}
