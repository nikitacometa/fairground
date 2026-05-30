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

import { useEffect, useState } from 'react';
import type { ApiResult } from '@fairground/types';

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

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        flex: '1 1 0',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        borderRadius: '8px',
        padding: '20px 24px',
        textAlign: 'center',
        minWidth: '140px',
      }}
    >
      <div
        style={{
          fontSize: '24px',
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums',
          marginBottom: '6px',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SkeletonBox() {
  return (
    <div
      style={{
        flex: '1 1 0',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        borderRadius: '8px',
        padding: '20px 24px',
        minWidth: '140px',
        height: '88px',
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

    load();
    const id = setInterval(load, 30_000);
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
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <SkeletonBox />
        <SkeletonBox />
        <SkeletonBox />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <StatBox
        label="Total Flips"
        value={stats.totalFlips.toLocaleString()}
        color="var(--color-primary)"
      />
      <StatBox
        label="Biggest Win"
        value={`${formatAlgo(stats.biggestWinMicroalgo)} ALGO`}
        color="var(--color-win)"
      />
      <StatBox
        label="Jackpot Pool"
        value={`${formatAlgo(stats.jackpotMicroalgo)} ALGO`}
        color="var(--color-vrf)"
      />
    </div>
  );
}
