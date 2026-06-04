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
 * Jackpot ticker — the growing pot that 1% of every resolved flip feeds. Polls /stats/live and
 * renders a subtle, always-present line above the game so the player feels the pot build. Returns
 * null until the first value loads (and on failure) so it never shows a misleading zero.
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
      className="flex w-full max-w-lg items-center justify-center gap-2 border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.25em]"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-text-dim)',
      }}
    >
      <span>◆ jackpot pool</span>
      <span style={{ color: 'var(--color-vrf)' }}>{formatAlgo(jackpot)} ALGO</span>
      <span style={{ opacity: 0.5 }}>· 1% of every flip</span>
    </div>
  );
}
