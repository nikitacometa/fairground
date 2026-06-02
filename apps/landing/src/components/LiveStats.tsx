/**
 * LiveStats — React island.
 *
 * Fetches live platform statistics from the Fairground API and renders them.
 * Renders server-side as a loading skeleton, hydrates client-side on load.
 *
 * API endpoint (GET): /stats/live
 * Response shape (bigint fields arrive as numeric strings):
 *   { totalFlips: string, biggestWinMicroalgo: string, jackpotMicroalgo: string }
 */

import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ApiResult } from '@fairground/types';

// Mouse-tracked amber spotlight: write pointer coords into CSS vars the ::before reads.
function handleSpotlightMove(e: ReactPointerEvent<HTMLDivElement>): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--x', `${e.clientX - r.left}px`);
  el.style.setProperty('--y', `${e.clientY - r.top}px`);
}
function handleSpotlightLeave(e: ReactPointerEvent<HTMLDivElement>): void {
  e.currentTarget.style.setProperty('--x', '-9999px');
  e.currentTarget.style.setProperty('--y', '-9999px');
}

interface LiveStatsData {
  totalFlips: bigint;
  biggestWinMicroalgo: bigint;
  jackpotMicroalgo: bigint;
}

interface LiveStatsWire {
  totalFlips: string;
  biggestWinMicroalgo: string;
  jackpotMicroalgo: string;
}

function formatAlgo(microalgo: bigint): string {
  const algo = Number(microalgo) / 1_000_000;
  return algo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Hairline amber rule between cells — a protocol data table, not consumer cards.
const HAIRLINE = 'oklch(0.78 0.18 65 / 0.14)';
const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  border: `1px solid ${HAIRLINE}`,
};
const CELL_PAD = 'clamp(14px, 3vw, 22px) clamp(12px, 2vw, 24px)';

function StatCell({
  label,
  value,
  color,
  isLast,
}: {
  label: string;
  value: string;
  color: string;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        padding: CELL_PAD,
        borderRight: isLast ? 'none' : `1px solid ${HAIRLINE}`,
        textAlign: 'left',
      }}
    >
      <div
        style={{
          fontSize: 'clamp(22px, 4vw, 38px)',
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums lining-nums',
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          marginBottom: '8px',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'oklch(0.78 0.18 65 / 0.4)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SkeletonCell({ isLast }: { isLast?: boolean }) {
  return (
    <div
      style={{
        padding: CELL_PAD,
        borderRight: isLast ? 'none' : `1px solid ${HAIRLINE}`,
        height: '92px',
        animation: 'pulse 1.8s ease-in-out infinite',
        opacity: 0.4,
      }}
    />
  );
}

export default function LiveStats() {
  const [stats, setStats] = useState<LiveStatsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const apiBase = (import.meta as Record<string, unknown>)['env']
      ? ((import.meta as { env: Record<string, string> }).env['PUBLIC_API_URL'] ?? '')
      : '';

    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${apiBase}/stats/live`);
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as ApiResult<LiveStatsWire>;
        if (!json.ok) throw new Error(json.error);
        if (!cancelled) {
          setStats({
            totalFlips: BigInt(json.data.totalFlips),
            biggestWinMicroalgo: BigInt(json.data.biggestWinMicroalgo),
            jackpotMicroalgo: BigInt(json.data.jackpotMicroalgo),
          });
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };

    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (error) {
    return null; // Silent failure — stats are nice-to-have, not critical
  }

  if (!stats) {
    return (
      <div style={GRID}>
        <SkeletonCell />
        <SkeletonCell />
        <SkeletonCell isLast />
      </div>
    );
  }

  return (
    <div
      className="spotlight-grid"
      style={GRID}
      onPointerMove={handleSpotlightMove}
      onPointerLeave={handleSpotlightLeave}
    >
      <StatCell
        label="Total Flips"
        value={stats.totalFlips.toLocaleString()}
        color="var(--color-primary)"
      />
      <StatCell
        label="Biggest Win"
        value={`${formatAlgo(stats.biggestWinMicroalgo)} ALGO`}
        color="var(--color-win)"
      />
      <StatCell
        label="Jackpot Pool"
        value={`${formatAlgo(stats.jackpotMicroalgo)} ALGO`}
        color="var(--color-vrf)"
        isLast
      />
    </div>
  );
}
