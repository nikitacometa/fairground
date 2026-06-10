'use client';

import { useEffect, useState } from 'react';

interface FullStats {
  product: {
    totalFlips: number;
    totalVolumeMicroalgo: string;
    uniquePlayers: number;
    headsCount: number;
    tailsCount: number;
    biggestWinMicroalgo: string;
  };
}

function fmtAlgo(micro: string, digits = 1): string {
  return (Number(micro) / 1_000_000).toFixed(digits);
}

/**
 * StatsStrip — the compact product-stats band shared by the feed and leaderboard pages:
 * flips · volume · heads/tails split · players. The heads% is the quiet star: a converging
 * ~50/50 IS the provably-fair pitch, rendered as data instead of copy. Hidden until loaded.
 */
export function StatsStrip() {
  const [stats, setStats] = useState<FullStats | null>(null);

  useEffect(() => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? '';
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${base}/stats`);
        if (!res.ok) return;
        const json = (await res.json()) as { ok: boolean; data?: FullStats };
        if (!cancelled && json.ok && json.data) setStats(json.data);
      } catch {
        // decorative band — stay hidden on failure rather than render zeros
      }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!stats) return null;
  const p = stats.product;
  const resolved = p.headsCount + p.tailsCount;
  const headsPct = resolved > 0 ? Math.round((p.headsCount / resolved) * 1000) / 10 : null;

  const cells: Array<{ label: string; value: string; color?: string }> = [
    { label: 'flips', value: String(p.totalFlips) },
    { label: 'volume · algo', value: fmtAlgo(p.totalVolumeMicroalgo, 0) },
    {
      label: 'heads rate',
      value: headsPct === null ? '—' : `${headsPct}%`,
      color: 'var(--color-vrf)',
    },
    { label: 'players', value: String(p.uniquePlayers) },
  ];

  return (
    <div
      className="grid w-full grid-cols-4 border font-mono"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className="flex flex-col items-center gap-0.5 px-1 py-2.5"
          style={i > 0 ? { borderLeft: '1px solid var(--color-border)' } : undefined}
        >
          <span
            className="text-sm font-bold tabular-nums sm:text-base"
            style={{ color: cell.color ?? 'var(--color-text)' }}
          >
            {cell.value}
          </span>
          <span
            className="text-[9px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {cell.label}
          </span>
        </div>
      ))}
    </div>
  );
}
