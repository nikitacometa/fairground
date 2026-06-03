import Link from 'next/link';
import { truncateAddress } from '@fairground/nfd';

// Recompute at most every 30s — a leaderboard does not need per-request freshness.
export const revalidate = 30;

interface LeaderEntry {
  rank: number;
  walletAddress: string;
  walletNfd: string | null;
  games: number;
  wins: number;
  winRate: number;
  volumeMicroalgo: string;
  netPnlMicroalgo: string;
}

async function fetchLeaderboard(): Promise<LeaderEntry[]> {
  const base = process.env['NEXT_PUBLIC_API_URL'] ?? '';
  try {
    const res = await fetch(`${base}/leaderboard/live?limit=20`, { next: { revalidate: 30 } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const data = (json as { data?: LeaderEntry[] } | null)?.data;
    return Array.isArray(data) ? data : [];
  } catch {
    // The board is non-critical: on an API hiccup, render the empty state, not an error page.
    return [];
  }
}

function toAlgo(micro: string): { text: string; positive: boolean } {
  const n = Number(micro) / 1_000_000;
  const sign = n > 0 ? '+' : '';
  return { text: `${sign}${n.toFixed(3)}`, positive: n >= 0 };
}

export default async function LeaderboardPage() {
  const entries = await fetchLeaderboard();

  return (
    <>
      <div className="bg-layer" aria-hidden />
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 py-10">
        <header className="flex w-full items-center justify-between">
          <a
            href="https://fairground.quest"
            className="text-lg font-bold tracking-[0.3em] uppercase transition-opacity hover:opacity-80"
            style={{ color: 'var(--color-primary)' }}
          >
            Fairground
          </a>
          <Link
            href="/"
            className="border px-4 py-2 text-sm font-mono uppercase tracking-wide transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}
          >
            [ ← Play ]
          </Link>
        </header>

        <div className="flex flex-col gap-1">
          <div
            className="font-mono text-[10px] uppercase tracking-[0.3em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Coinflip // standings
          </div>
          <h1
            className="text-2xl font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-primary)' }}
          >
            Leaderboard
          </h1>
          <p className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Ranked by net P&amp;L. Every result derived on-chain from VRF. Verifiable by anyone.
          </p>
        </div>

        {entries.length === 0 ? (
          <div
            className="border border-dashed px-6 py-16 text-center font-mono text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            &gt; no operatives registered // be first
          </div>
        ) : (
          <table className="w-full border-collapse font-mono text-sm">
            <thead>
              <tr
                className="text-[10px] uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <th className="py-2 pr-2 text-left font-normal">#</th>
                <th className="py-2 pr-2 text-left font-normal">Operative</th>
                <th className="py-2 pr-2 text-right font-normal">Games</th>
                <th className="py-2 pr-2 text-right font-normal">Win%</th>
                <th className="py-2 text-right font-normal">Net P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const pnl = toAlgo(e.netPnlMicroalgo);
                const isNfd = Boolean(e.walletNfd);
                return (
                  <tr
                    key={e.walletAddress}
                    className="border-t"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td
                      className="py-3 pr-2 tabular-nums"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {String(e.rank).padStart(2, '0')}
                    </td>
                    <td
                      className="py-3 pr-2"
                      style={{ color: isNfd ? 'var(--color-primary)' : 'var(--color-text-dim)' }}
                      title={e.walletAddress}
                    >
                      {e.walletNfd ?? truncateAddress(e.walletAddress)}
                    </td>
                    <td
                      className="py-3 pr-2 text-right tabular-nums"
                      style={{ color: 'var(--color-text-dim)' }}
                    >
                      {e.games}
                    </td>
                    <td
                      className="py-3 pr-2 text-right tabular-nums"
                      style={{ color: 'var(--color-text-dim)' }}
                    >
                      {e.winRate}%
                    </td>
                    <td
                      className="py-3 text-right font-bold tabular-nums"
                      style={{ color: pnl.positive ? 'var(--color-win)' : 'var(--color-lose)' }}
                    >
                      {pnl.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <p
          className="mt-2 font-mono text-[10px] tracking-wide"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Net P&amp;L = winnings − stakes, across resolved flips · names via NFD · updates every 30s
        </p>
      </main>
    </>
  );
}
