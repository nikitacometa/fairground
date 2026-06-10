import { truncateAddress } from '@fairground/nfd';
import { NavTabs } from '../../components/NavTabs';
import { StatsStrip } from '../../components/StatsStrip';

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

function toAlgo(micro: string, digits = 3): { text: string; positive: boolean } {
  const n = Number(micro) / 1_000_000;
  const sign = n > 0 ? '+' : '';
  return { text: `${sign}${n.toFixed(digits)}`, positive: n >= 0 };
}

// Podium accents: champion gold (brand primary), silver, bronze.
const PODIUM = [
  {
    color: 'var(--color-primary)',
    border: 'oklch(0.78 0.18 65 / 0.55)',
    glow: '0 0 24px oklch(0.78 0.18 65 / 0.22)',
    tag: 'champion',
  },
  {
    color: 'oklch(0.82 0.01 60)',
    border: 'oklch(0.82 0.01 60 / 0.35)',
    glow: 'none',
    tag: 'runner-up',
  },
  {
    color: 'oklch(0.66 0.10 55)',
    border: 'oklch(0.66 0.10 55 / 0.35)',
    glow: 'none',
    tag: 'third',
  },
] as const;

function PodiumCard({ entry, place }: { entry: LeaderEntry; place: 0 | 1 | 2 }) {
  const p = PODIUM[place];
  const pnl = toAlgo(entry.netPnlMicroalgo, 2);
  const isNfd = Boolean(entry.walletNfd);
  // DOM order is 1→2→3 (correct for the mobile stack); on desktop the champion moves to the
  // center column and rises slightly: silver | gold | bronze.
  const desktopOrder = place === 0 ? 'sm:order-2' : place === 1 ? 'sm:order-1' : 'sm:order-3';
  return (
    <div
      className={`flex flex-col items-center gap-1.5 border px-3 py-4 text-center ${desktopOrder} ${place === 0 ? 'sm:-mt-3 sm:py-6' : ''}`}
      style={{
        borderColor: p.border,
        background: 'var(--color-surface)',
        boxShadow: p.glow,
      }}
    >
      <div
        className="font-mono text-[9px] uppercase tracking-[0.3em]"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {p.tag}
      </div>
      <div
        className={`font-mono font-bold tabular-nums ${place === 0 ? 'text-3xl' : 'text-2xl'}`}
        style={{ color: p.color }}
      >
        {String(entry.rank).padStart(2, '0')}
      </div>
      <div
        className="w-full truncate font-mono text-xs font-semibold"
        style={{ color: isNfd ? 'var(--color-primary)' : 'var(--color-text-dim)' }}
        title={entry.walletAddress}
      >
        {entry.walletNfd ?? truncateAddress(entry.walletAddress)}
      </div>
      <div
        className={`font-mono font-bold tabular-nums ${place === 0 ? 'text-lg' : 'text-base'}`}
        style={{ color: pnl.positive ? 'var(--color-win)' : 'var(--color-lose)' }}
      >
        {pnl.text}
        <span className="ml-1 text-[9px] opacity-70">ALGO</span>
      </div>
      <div
        className="font-mono text-[10px] tabular-nums"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {entry.games} flips · {entry.winRate}% win
      </div>
    </div>
  );
}

function WinRateBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <div
        className="h-1 w-10 overflow-hidden"
        style={{ background: 'var(--color-border)' }}
        aria-hidden
      >
        <div
          className="h-full"
          style={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            background: pct >= 50 ? 'var(--color-win)' : 'var(--color-text-muted)',
          }}
        />
      </div>
      <span className="tabular-nums">{pct}%</span>
    </div>
  );
}

export default async function LeaderboardPage() {
  const entries = await fetchLeaderboard();
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  const placeOf = (e: LeaderEntry): 0 | 1 | 2 => (e.rank === 1 ? 0 : e.rank === 2 ? 1 : 2);

  return (
    <>
      <div className="bg-layer" aria-hidden />
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-2xl flex-col items-center gap-6 px-4 py-8">
        <header className="flex w-full items-center justify-between gap-3">
          <a
            href="https://fairground.quest"
            className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
          >
            <span
              aria-hidden
              className="text-sm leading-none sm:text-base"
              style={{ color: 'var(--color-primary)' }}
            >
              ◆
            </span>
            <span
              className="font-bold uppercase tracking-[0.18em] text-[15px] sm:text-lg sm:tracking-[0.3em]"
              style={{
                color: 'var(--color-primary)',
                textShadow: '0 0 18px oklch(0.78 0.18 65 / 0.35)',
              }}
            >
              Fairground
            </span>
          </a>
        </header>

        <NavTabs active="board" />

        <div className="flex w-full flex-col gap-1">
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

        <StatsStrip />

        {entries.length === 0 ? (
          <div
            className="w-full border border-dashed px-6 py-16 text-center font-mono text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            &gt; no operatives registered // be first
          </div>
        ) : (
          <>
            {/* Top-3 podium — champion centered + raised on desktop, stacked 1→2→3 on mobile */}
            {podium.length > 0 && (
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start">
                {podium.map((e) => (
                  <PodiumCard key={e.walletAddress} entry={e} place={placeOf(e)} />
                ))}
              </div>
            )}

            {rest.length > 0 && (
              <table className="w-full border-collapse font-mono text-sm">
                <thead>
                  <tr
                    className="text-[10px] uppercase tracking-[0.2em]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    <th className="py-2 pr-2 text-left font-normal">#</th>
                    <th className="py-2 pr-2 text-left font-normal">Operative</th>
                    <th className="py-2 pr-2 text-right font-normal">Flips</th>
                    <th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">Win%</th>
                    <th className="py-2 text-right font-normal">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((e) => {
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
                          className="max-w-0 truncate py-3 pr-2"
                          style={{
                            color: isNfd ? 'var(--color-primary)' : 'var(--color-text-dim)',
                          }}
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
                          className="hidden py-3 pr-2 text-right text-xs sm:table-cell"
                          style={{ color: 'var(--color-text-dim)' }}
                        >
                          <WinRateBar pct={e.winRate} />
                        </td>
                        <td
                          className="py-3 text-right font-bold tabular-nums"
                          style={{
                            color: pnl.positive ? 'var(--color-win)' : 'var(--color-lose)',
                          }}
                        >
                          {pnl.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        <p
          className="font-mono text-[10px] tracking-wide"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Net P&amp;L = winnings − stakes, across resolved flips · names via NFD · updates every 30s
        </p>
      </main>
    </>
  );
}
