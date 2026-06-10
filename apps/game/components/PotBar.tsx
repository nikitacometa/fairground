'use client';

/**
 * PotBar — slim full-width bar that replaces the decorative JackpotTicker.
 *
 * Shows:
 *   ◆ daily pot {X.XX} ALGO   · draw in HH:MM:SS   [· your tickets: N when connected]
 *
 * The pot amount count-up fires on each poll increment (rAF lerp ~800 ms, respects
 * prefers-reduced-motion). The countdown ticks every second from nextDrawAt (ISO).
 * When <0 it reads "drawing…". Hidden until the first successful load. Renders null
 * when JACKPOT_APP_ID === 0n (503 jackpot_not_configured) so it never blocks layout.
 *
 * Wraps the whole bar in <a href="/pot"> — tapping anywhere navigates to the pot page.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import { usePotState } from './usePotState';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function microToAlgo(micro: string): number {
  return Number(BigInt(micro)) / 1_000_000;
}

function formatAlgo(n: number): string {
  return n.toFixed(2);
}

function buildCountdown(nextDrawAt: string, nowMs: number): string {
  const target = Date.parse(nextDrawAt);
  const diffMs = target - nowMs;
  if (diffMs <= 0) return 'drawing…';
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const COUNT_UP_MS = 800;

// -------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------

export function PotBar(): ReactElement | null {
  const { activeAccount } = useWallet();
  // Hydration guard — wallet state only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const address = mounted ? (activeAccount?.address ?? null) : null;
  const potState = usePotState(address);

  // Displayed pot value (count-up target driven by count-up animation).
  const [displayAlgo, setDisplayAlgo] = useState(0);
  const prevAlgoRef = useRef(0);
  const rafRef = useRef(0);

  // Countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Count-up animation when pot increases.
  useEffect(() => {
    if (!potState || !potState.configured) return;
    const target = microToAlgo(potState.data.potMicroalgo);
    const from = prevAlgoRef.current;
    prevAlgoRef.current = target;

    // On first load jump directly; on subsequent increases animate up.
    if (from === 0) {
      setDisplayAlgo(target);
      return;
    }

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce || target <= from) {
      setDisplayAlgo(target);
      return;
    }

    cancelAnimationFrame(rafRef.current);
    const start = Date.now();
    const tick = (): void => {
      const t = Math.min(1, (Date.now() - start) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayAlgo(from + (target - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayAlgo(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [potState]);

  // Not loaded yet or explicitly not configured — render nothing.
  if (!potState) return null;
  if (!potState.configured) return null;

  const { data } = potState;
  const countdown = buildCountdown(data.nextDrawAt, now);
  const myTickets = data.myTickets ? BigInt(data.myTickets) : null;

  return (
    <a
      href="/pot"
      className="block w-full max-w-lg no-underline"
      aria-label="Daily pot — view details"
    >
      <div
        className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-0.5 border px-3 py-1.5 text-center font-mono text-xs uppercase tracking-[0.18em] sm:text-[11px] sm:tracking-[0.22em]"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-text-dim)',
        }}
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span style={{ color: 'var(--color-primary)' }}>◆</span>
          <span>daily pot</span>
          <span className="tabular-nums font-bold" style={{ color: 'var(--color-primary)' }}>
            {formatAlgo(displayAlgo)} ALGO
          </span>
        </span>

        <span className="whitespace-nowrap" style={{ opacity: 0.7 }}>
          · draw in{' '}
          <span className="tabular-nums" style={{ color: 'var(--color-vrf)' }}>
            {countdown}
          </span>
        </span>

        {myTickets !== null && (
          <span className="whitespace-nowrap" style={{ opacity: 0.7 }}>
            · your tickets:{' '}
            <span className="tabular-nums" style={{ color: 'var(--color-text)' }}>
              {myTickets.toString()}
            </span>
          </span>
        )}
      </div>
    </a>
  );
}
