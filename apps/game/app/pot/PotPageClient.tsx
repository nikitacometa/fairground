'use client';

/**
 * PotPageClient — the interactive client island for /pot.
 *
 * Renders:
 *   - Hero pot number with count-up
 *   - Live countdown to next draw
 *   - My tickets (when wallet connected)
 *   - Transparency table (params from API)
 *   - Draw history (from /jackpot/draws, polled 30 s)
 *
 * All bigint values arrive as strings from the API and are kept as strings unless
 * a numeric operation is needed (displayed with bigint math to preserve precision).
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import { usePotState } from '../../components/usePotState';
import { truncateAddress } from '@fairground/nfd';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function fmtAlgo(micro: string, digits = 2): string {
  const m = BigInt(micro);
  const whole = m / 1_000_000n;
  const frac = (m % 1_000_000n).toString().padStart(6, '0').slice(0, digits);
  return `${whole.toString()}.${frac}`;
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

function relTime(iso: string | null, now: number): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const COUNT_UP_MS = 800;

// -------------------------------------------------------------------------
// Draw history types (from /jackpot/draws)
// -------------------------------------------------------------------------

interface DrawWinner {
  address: string;
  nfd: string | null;
  payoutMicroalgo: string;
}

interface DrawRow {
  epochId: string;
  potMicroalgo: string;
  rolloverMicroalgo: string;
  totalTickets: string;
  vrfRound: string;
  drawnAt: string | null;
  proofUrl: string | null;
  winner: DrawWinner | null;
  runnersUp: DrawWinner[];
  resolveTxnId?: string | null;
}

// -------------------------------------------------------------------------
// Stats for houseEdgeBps (for transparency table)
// -------------------------------------------------------------------------

interface StatsContract {
  houseEdgeBps?: number;
}
interface StatsData {
  contract?: StatsContract;
}

// -------------------------------------------------------------------------
// Sub-components
// -------------------------------------------------------------------------

function HeroPot({
  potMicroalgo,
  nextDrawAt,
}: {
  potMicroalgo: string;
  nextDrawAt: string;
}): ReactElement {
  const [displayAlgo, setDisplayAlgo] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const prevRef = useRef(0);
  const rafRef = useRef(0);

  // Countdown tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Count-up on pot change
  useEffect(() => {
    const target = Number(BigInt(potMicroalgo)) / 1_000_000;
    const from = prevRef.current;
    prevRef.current = target;

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
  }, [potMicroalgo]);

  const countdown = buildCountdown(nextDrawAt, now);

  return (
    <div className="flex w-full flex-col items-center gap-3 py-4">
      <div
        className="font-mono text-[9px] uppercase tracking-[0.35em]"
        style={{ color: 'var(--color-text-muted)' }}
      >
        current pot
      </div>
      <div
        className="tabular-nums text-5xl font-bold sm:text-6xl"
        style={{
          color: 'var(--color-primary)',
          textShadow: '0 0 24px oklch(0.78 0.18 65 / 0.3)',
          letterSpacing: '-0.02em',
        }}
      >
        {displayAlgo.toFixed(2)}
        <span className="ml-2 text-2xl sm:text-3xl" style={{ opacity: 0.6 }}>
          ALGO
        </span>
      </div>
      <div
        className="font-mono text-xs uppercase tracking-[0.2em]"
        style={{ color: 'var(--color-text-muted)' }}
      >
        draw in{' '}
        <span className="tabular-nums" style={{ color: 'var(--color-vrf)' }}>
          {countdown}
        </span>
      </div>
    </div>
  );
}

function MyTickets({
  myTickets,
  myWageredThisEpoch,
}: {
  myTickets: string | undefined;
  myWageredThisEpoch: string | undefined;
}): ReactElement | null {
  if (!myTickets) return null;
  const tickets = BigInt(myTickets);
  return (
    <div
      className="flex w-full items-center justify-between border px-4 py-3 font-mono text-sm"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>your tickets this epoch</span>
      <span className="tabular-nums font-bold" style={{ color: 'var(--color-primary)' }}>
        {tickets.toString()}
        {myWageredThisEpoch && (
          <span
            className="ml-2 text-[10px] font-normal"
            style={{ color: 'var(--color-text-muted)' }}
          >
            · {fmtAlgo(myWageredThisEpoch, 2)} ALGO wagered
          </span>
        )}
      </span>
    </div>
  );
}

function HowItWorks(): ReactElement {
  return (
    <div
      className="flex w-full flex-col gap-2 border px-4 py-4 font-mono text-xs"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div
        className="text-[9px] uppercase tracking-[0.3em]"
        style={{ color: 'var(--color-text-muted)' }}
      >
        how it works
      </div>
      <p style={{ color: 'var(--color-text-dim)' }}>
        &gt; play any game — every flip feeds the pot
      </p>
      <p style={{ color: 'var(--color-text-dim)' }}>
        &gt; 1 ALGO wagered = 1 ticket · every wallet holds at least one
      </p>
      <p style={{ color: 'var(--color-text-dim)' }}>
        &gt; daily VRF draw at 20:00 UTC — winner 70%, five runners-up 4% each, 10% compounds
      </p>
    </div>
  );
}

function TransparencyTable({
  jackpotBps,
  winnerBps,
  runnerBps,
  runnerCount,
  backstopMicroalgo,
  houseEdgeBps,
}: {
  jackpotBps: number;
  winnerBps: number;
  runnerBps: number;
  runnerCount: number;
  backstopMicroalgo: string;
  houseEdgeBps: number | null;
}): ReactElement {
  const rows: Array<[string, string]> = [
    ['pot stream per flip', `${(jackpotBps / 100).toFixed(2)}% of stake`],
    ['winner share', `${(winnerBps / 100).toFixed(0)}%`],
    [`runners-up (${runnerCount}x)`, `${(runnerBps / 100).toFixed(0)}% each`],
    ['rollover (remainder)', 'compounds into next epoch'],
    ['backstop floor', `${fmtAlgo(backstopMicroalgo, 0)} ALGO`],
    ...(houseEdgeBps !== null
      ? [['house edge (flip)', `${(houseEdgeBps / 100).toFixed(2)}%`] as [string, string]]
      : []),
  ];

  return (
    <div
      className="flex w-full flex-col border font-mono text-xs"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div
        className="border-b px-4 py-2 text-[9px] uppercase tracking-[0.3em]"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        transparency · live params
      </div>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex items-center justify-between border-b px-4 py-2 last:border-b-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
          <span className="tabular-nums" style={{ color: 'var(--color-text-dim)' }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function DrawHistory({ apiBase }: { apiBase: string }): ReactElement {
  const [draws, setDraws] = useState<DrawRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${apiBase}/jackpot/draws?limit=30`);
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { ok: boolean; data?: DrawRow[] };
        if (!cancelled && json.ok && Array.isArray(json.data)) {
          setDraws(json.data);
          setNow(Date.now());
        }
      } catch {
        // keep last known list
      }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiBase]);

  if (draws === null) {
    return (
      <div
        className="border border-dashed px-6 py-8 text-center font-mono text-xs"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        &gt; loading draw history…
      </div>
    );
  }

  if (draws.length === 0) {
    return (
      <div
        className="border border-dashed px-6 py-8 text-center font-mono text-xs"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        &gt; no draws yet // first draw at 20:00 utc
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr
            className="text-[9px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <th className="py-2 pr-3 text-left font-normal">#</th>
            <th className="py-2 pr-3 text-right font-normal">pot</th>
            <th className="py-2 pr-3 text-left font-normal">winner</th>
            <th className="py-2 pr-3 text-right font-normal">their take</th>
            <th className="hidden py-2 pr-3 text-right font-normal sm:table-cell">vrf</th>
            <th className="py-2 pr-3 text-right font-normal">when</th>
            <th className="py-2 text-right font-normal">links</th>
          </tr>
        </thead>
        <tbody>
          {draws.map((d) => {
            const winner = d.winner;
            const winnerLabel = winner ? (winner.nfd ?? truncateAddress(winner.address)) : '—';
            const isNfd = Boolean(winner?.nfd);
            const cardUrl = `${apiBase}/proof/draw/${d.epochId}`;
            const txUrl = d.resolveTxnId ? `https://allo.info/tx/${d.resolveTxnId}` : null;
            return (
              <tr
                key={d.epochId}
                className="border-t"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <td
                  className="py-2.5 pr-3 tabular-nums"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {d.epochId}
                </td>
                <td
                  className="py-2.5 pr-3 text-right tabular-nums"
                  style={{ color: 'var(--color-text-dim)' }}
                >
                  {fmtAlgo(d.potMicroalgo, 2)}
                </td>
                <td
                  className="max-w-0 truncate py-2.5 pr-3"
                  style={{ color: isNfd ? 'var(--color-primary)' : 'var(--color-text-dim)' }}
                  title={winner?.address}
                >
                  {winnerLabel}
                </td>
                <td
                  className="py-2.5 pr-3 text-right tabular-nums"
                  style={{ color: 'var(--color-win)' }}
                >
                  {winner ? fmtAlgo(winner.payoutMicroalgo, 2) : '—'}
                </td>
                <td
                  className="hidden py-2.5 pr-3 text-right tabular-nums sm:table-cell"
                  style={{ color: 'var(--color-vrf)' }}
                >
                  #{d.vrfRound}
                </td>
                <td
                  className="py-2.5 pr-3 text-right tabular-nums"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {relTime(d.drawnAt, now)}
                </td>
                <td className="py-2.5 text-right">
                  <span className="flex items-center justify-end gap-2">
                    <a
                      href={cardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-text-dim)' }}
                    >
                      card
                    </a>
                    {txUrl && (
                      <a
                        href={txUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition-opacity hover:opacity-70"
                        style={{ color: 'var(--color-vrf)' }}
                      >
                        tx ↗
                      </a>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------------------
// Main export
// -------------------------------------------------------------------------

export function PotPageClient(): ReactElement {
  const { activeAccount } = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const address = mounted ? (activeAccount?.address ?? null) : null;
  const potState = usePotState(address);

  // Fetch houseEdgeBps from /stats for transparency table.
  const [houseEdgeBps, setHouseEdgeBps] = useState<number | null>(null);
  useEffect(() => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? '';
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${base}/stats`);
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { ok: boolean; data?: StatsData };
        if (!cancelled && json.ok && json.data?.contract?.houseEdgeBps != null) {
          setHouseEdgeBps(json.data.contract.houseEdgeBps);
        }
      } catch {
        // decorative — keep null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? '';

  if (!potState) {
    return (
      <div
        className="py-12 text-center font-mono text-xs"
        style={{ color: 'var(--color-text-muted)' }}
      >
        &gt; loading pot…
      </div>
    );
  }

  if (!potState.configured) {
    return (
      <div
        className="py-12 text-center font-mono text-xs"
        style={{ color: 'var(--color-text-muted)' }}
      >
        &gt; daily pot launches soon
      </div>
    );
  }

  const { data } = potState;

  return (
    <div className="flex w-full flex-col gap-4">
      <HeroPot potMicroalgo={data.potMicroalgo} nextDrawAt={data.nextDrawAt} />

      <HowItWorks />

      {mounted && address && (
        <MyTickets myTickets={data.myTickets} myWageredThisEpoch={data.myWageredThisEpoch} />
      )}

      <TransparencyTable
        jackpotBps={data.params.jackpotBps}
        winnerBps={data.params.winnerBps}
        runnerBps={data.params.runnerBps}
        runnerCount={data.params.runnerCount}
        backstopMicroalgo={data.params.backstopMicroalgo}
        houseEdgeBps={houseEdgeBps}
      />

      <div className="flex w-full flex-col gap-2">
        <div
          className="font-mono text-[9px] uppercase tracking-[0.3em]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          draw history
        </div>
        <DrawHistory apiBase={apiBase} />
      </div>
    </div>
  );
}
