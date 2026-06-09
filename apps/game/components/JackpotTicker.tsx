'use client';

import { useEffect, useState, type ReactElement } from 'react';

// Format microALGO without Number (amounts are bigint; precision must hold).
function formatAlgo(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${frac}`;
}

interface StatsWire {
  ok: boolean;
  data?: { jackpotMicroalgo: string };
}

/**
 * Jackpot seed ticker — a decorative counter equal to 1% of all resolved flip volume, the slice
 * set aside to seed the future jackpot draw (ships in v1.2). Deliberately labelled "seed", not
 * "pool": there is no payout mechanic yet, so the copy must not imply a claimable prize. Polls
 * /stats/live and renders a subtle line above the game. Returns null until the first value loads
 * (and on failure) so it never shows a misleading zero.
 */
export function JackpotTicker(): ReactElement | null {
  const [jackpot, setJackpot] = useState<bigint | null>(null);

  useEffect(() => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? '';
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${base}/stats/live`);
        if (!res.ok) return;
        const json = (await res.json()) as StatsWire;
        if (!cancelled && json.ok && json.data) setJackpot(BigInt(json.data.jackpotMicroalgo));
      } catch {
        // nice-to-have; leave the ticker hidden on failure rather than show a fake value
      }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (jackpot === null) return null;

  return (
    <div
      className="flex w-full max-w-lg flex-col items-center gap-0.5 border px-3 py-1.5 text-center font-mono text-[11px] uppercase tracking-[0.18em] sm:flex-row sm:justify-center sm:gap-2 sm:tracking-[0.25em]"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-text-dim)',
      }}
    >
      {/* Value first (and on its own line on mobile), descriptor second — so neither wraps mid-phrase. */}
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span>◆ jackpot seed</span>
        <span style={{ color: 'var(--color-vrf)' }}>{formatAlgo(jackpot)} ALGO</span>
      </span>
      <span className="whitespace-nowrap" style={{ opacity: 0.5 }}>
        <span className="hidden sm:inline">· </span>1% of every flip · v1.2
      </span>
    </div>
  );
}
