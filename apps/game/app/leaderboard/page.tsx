import Link from 'next/link';
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

interface FairEntry {
  rank: number;
  walletAddress: string;
  walletNfd: string | null;
  flips: number;
  flipPoints: number;
  taps: number;
  tapPoints: number;
  totalPoints: number;
}

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '';

async function fetchJsonData<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate: 30 } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const data = (json as { data?: T[] } | null)?.data;
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

const fmt = (n: number): string => n.toLocaleString('en-US');

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

interface PodiumCardProps {
  place: 0 | 1 | 2;
  rank: number;
  walletAddress: string;
  walletNfd: string | null;
  /** Hero stat (already formatted) + its color + unit suffix. */
  hero: string;
  heroColor: string;
  heroUnit: string;
  /** One quiet context line under the hero stat. */
  sub: string;
}

function PodiumCard({
  place,
  rank,
  walletAddress,
  walletNfd,
  hero,
  heroColor,
  heroUnit,
  sub,
}: PodiumCardProps) {
  const p = PODIUM[place];
  const isNfd = Boolean(walletNfd);
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
        {String(rank).padStart(2, '0')}
      </div>
      <div
        className="w-full truncate font-mono text-xs font-semibold"
        style={{ color: isNfd ? 'var(--color-primary)' : 'var(--color-text-dim)' }}
        title={walletAddress}
      >
        {walletNfd ?? truncateAddress(walletAddress)}
      </div>
      <div
        className={`font-mono font-bold tabular-nums ${place === 0 ? 'text-lg' : 'text-base'}`}
        style={{ color: heroColor }}
      >
        {hero}
        <span className="ml-1 text-[9px] opacity-70">{heroUnit}</span>
      </div>
      <div
        className="font-mono text-[10px] tabular-nums"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {sub}
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

// Sub-switcher between the two rankings. Plain links so the server component stays hook-free.
function BoardSwitch({ board }: { board: 'pnl' | 'fair' }) {
  const tabs = [
    { key: 'pnl' as const, href: '/leaderboard', label: 'net p&l' },
    { key: 'fair' as const, href: '/leaderboard?board=fair', label: '◈ fair points' },
  ];
  return (
    <div className="flex w-full items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em]">
      {tabs.map((t) => {
        const isActive = t.key === board;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className="border px-3 py-1.5 transition-opacity hover:opacity-80"
            style={{
              borderColor: isActive ? 'var(--color-primary)' : 'var(--color-border)',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              background: isActive ? 'var(--color-primary-dim)' : 'transparent',
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

const TABLE_HEAD_CLS = 'text-[10px] uppercase tracking-[0.2em]';
const ROW_BORDER = { borderColor: 'var(--color-border)' };

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const board: 'pnl' | 'fair' = sp['board'] === 'fair' ? 'fair' : 'pnl';

  const entries =
    board === 'fair'
      ? await fetchJsonData<FairEntry>('/points/leaderboard?limit=20')
      : await fetchJsonData<LeaderEntry>('/leaderboard/live?limit=20');

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  const placeOf = (rank: number): 0 | 1 | 2 => (rank === 1 ? 0 : rank === 2 ? 1 : 2);

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
            {board === 'fair'
              ? 'Ranked by FAIR points: 100 per resolved flip + coin taps during the seal wait. Formula is public.'
              : 'Ranked by net P&L. Every result derived on-chain from VRF. Verifiable by anyone.'}
          </p>
        </div>

        <BoardSwitch board={board} />

        <StatsStrip />

        {entries.length === 0 ? (
          <div
            className="w-full border border-dashed px-6 py-16 text-center font-mono text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            {board === 'fair'
              ? '> no points banked yet // flip, then tap the coin while it seals'
              : '> no operatives registered // be first'}
          </div>
        ) : (
          <>
            {/* Top-3 podium — champion centered + raised on desktop, stacked 1→2→3 on mobile */}
            {podium.length > 0 && (
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start">
                {board === 'fair'
                  ? (podium as FairEntry[]).map((e) => (
                      <PodiumCard
                        key={e.walletAddress}
                        place={placeOf(e.rank)}
                        rank={e.rank}
                        walletAddress={e.walletAddress}
                        walletNfd={e.walletNfd}
                        hero={`◈ ${fmt(e.totalPoints)}`}
                        heroColor="var(--color-primary)"
                        heroUnit="fair"
                        sub={`${fmt(e.flips)} flips · ${fmt(e.taps)} taps`}
                      />
                    ))
                  : (podium as LeaderEntry[]).map((e) => {
                      const pnl = toAlgo(e.netPnlMicroalgo, 2);
                      return (
                        <PodiumCard
                          key={e.walletAddress}
                          place={placeOf(e.rank)}
                          rank={e.rank}
                          walletAddress={e.walletAddress}
                          walletNfd={e.walletNfd}
                          hero={pnl.text}
                          heroColor={pnl.positive ? 'var(--color-win)' : 'var(--color-lose)'}
                          heroUnit="ALGO"
                          sub={`${e.games} flips · ${e.winRate}% win`}
                        />
                      );
                    })}
              </div>
            )}

            {rest.length > 0 && board === 'fair' && (
              <table className="w-full border-collapse font-mono text-sm">
                <thead>
                  <tr className={TABLE_HEAD_CLS} style={{ color: 'var(--color-text-muted)' }}>
                    <th className="py-2 pr-2 text-left font-normal">#</th>
                    <th className="py-2 pr-2 text-left font-normal">Operative</th>
                    <th className="py-2 pr-2 text-right font-normal">Flips</th>
                    <th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">Taps</th>
                    <th className="py-2 text-right font-normal">Fair</th>
                  </tr>
                </thead>
                <tbody>
                  {(rest as FairEntry[]).map((e) => (
                    <tr key={e.walletAddress} className="border-t" style={ROW_BORDER}>
                      <td
                        className="py-3 pr-2 tabular-nums"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {String(e.rank).padStart(2, '0')}
                      </td>
                      <td
                        className="max-w-0 truncate py-3 pr-2"
                        style={{
                          color: e.walletNfd ? 'var(--color-primary)' : 'var(--color-text-dim)',
                        }}
                        title={e.walletAddress}
                      >
                        {e.walletNfd ?? truncateAddress(e.walletAddress)}
                      </td>
                      <td
                        className="py-3 pr-2 text-right tabular-nums"
                        style={{ color: 'var(--color-text-dim)' }}
                      >
                        {fmt(e.flips)}
                      </td>
                      <td
                        className="hidden py-3 pr-2 text-right tabular-nums sm:table-cell"
                        style={{ color: 'var(--color-text-dim)' }}
                      >
                        {fmt(e.taps)}
                      </td>
                      <td
                        className="py-3 text-right font-bold tabular-nums"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        ◈ {fmt(e.totalPoints)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {rest.length > 0 && board === 'pnl' && (
              <table className="w-full border-collapse font-mono text-sm">
                <thead>
                  <tr className={TABLE_HEAD_CLS} style={{ color: 'var(--color-text-muted)' }}>
                    <th className="py-2 pr-2 text-left font-normal">#</th>
                    <th className="py-2 pr-2 text-left font-normal">Operative</th>
                    <th className="py-2 pr-2 text-right font-normal">Flips</th>
                    <th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">Win%</th>
                    <th className="py-2 text-right font-normal">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {(rest as LeaderEntry[]).map((e) => {
                    const pnl = toAlgo(e.netPnlMicroalgo);
                    const isNfd = Boolean(e.walletNfd);
                    return (
                      <tr key={e.walletAddress} className="border-t" style={ROW_BORDER}>
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
          {board === 'fair'
            ? 'FAIR = 100 × resolved flips + tap points (cap 100/flip, one hidden ×10 golden tap) · names via NFD · updates every 30s'
            : 'Net P&L = winnings − stakes, across resolved flips · names via NFD · updates every 30s'}
        </p>
      </main>
    </>
  );
}
