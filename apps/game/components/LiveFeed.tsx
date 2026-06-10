'use client';

/**
 * LiveFeed — the public real-time ledger of resolved flips. Polls GET /feed every 6s (the API
 * caches the query 5s in Redis, so a crowd of viewers costs ~1 DB query per 5s) and flashes
 * newly-arrived rows amber. Every row links the resolve txn (explorer) and the proof card —
 * social proof a visitor can click, not copy they have to trust.
 */

import { useEffect, useRef, useState } from 'react';

interface FeedRow {
  id: string;
  walletAddress: string;
  walletNfd: string | null;
  betMicroalgo: string;
  pick: 'heads' | 'tails' | null;
  landed: 'heads' | 'tails' | null;
  outcome: 'win' | 'loss';
  payoutMicroalgo: string;
  vrfRound: string;
  txnId: string | null;
  proofUrl: string | null;
  resolvedAt: string | null;
}

const POLL_MS = 6_000;

function fmtAlgo(micro: string, digits = 2): string {
  return (Number(micro) / 1_000_000).toFixed(digits);
}

function truncAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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

export function LiveFeed() {
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Rows seen on previous polls — anything not in here when a poll lands is "new" and flashes.
  const seenIds = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? '';
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${base}/feed?limit=50`);
        if (!res.ok) return;
        const json = (await res.json()) as { ok: boolean; data?: FeedRow[] };
        if (cancelled || !json.ok || !Array.isArray(json.data)) return;
        const incoming = json.data;
        // First load fills the ledger without a wall of flashes; later loads flash arrivals.
        const isFirst = seenIds.current.size === 0;
        const fresh = isFirst ? [] : incoming.filter((r) => !seenIds.current.has(r.id));
        for (const r of incoming) seenIds.current.add(r.id);
        setRows(incoming);
        setNow(Date.now());
        if (fresh.length > 0) setNewIds(new Set(fresh.map((r) => r.id)));
      } catch {
        // keep showing the last good ledger on a transient failure
      }
    };
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (rows === null) {
    return (
      <div
        className="border border-dashed px-6 py-16 text-center font-mono text-sm"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        &gt; syncing ledger…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className="border border-dashed px-6 py-16 text-center font-mono text-sm"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        &gt; no flips recorded yet // be the first
      </div>
    );
  }

  return (
    <ul className="w-full font-mono">
      {rows.map((r) => {
        const win = r.outcome === 'win';
        // A win pays net_payout on top of nothing (stake already gone to escrow) — net to the
        // player is payout − stake. A loss is −stake. Show the player's net delta.
        const deltaMicro = win
          ? BigInt(r.payoutMicroalgo) - BigInt(r.betMicroalgo)
          : -BigInt(r.betMicroalgo);
        const deltaAlgo = (Number(deltaMicro) / 1_000_000).toFixed(2);
        const explorer = r.txnId ? `https://allo.info/tx/${r.txnId}` : null;
        return (
          <li
            key={r.id}
            className={`border-t px-2 py-2.5 text-xs ${newIds.has(r.id) ? 'feed-row-new' : ''}`}
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className="truncate font-semibold"
                style={{ color: r.walletNfd ? 'var(--color-primary)' : 'var(--color-text-dim)' }}
                title={r.walletAddress}
              >
                {r.walletNfd ?? truncAddr(r.walletAddress)}
              </span>
              <span
                className="shrink-0 font-bold tabular-nums"
                style={{ color: win ? 'var(--color-win)' : 'var(--color-lose)' }}
              >
                {deltaMicro >= 0n ? '+' : ''}
                {deltaAlgo}
                <span className="ml-1 text-[9px] opacity-70">ALGO</span>
              </span>
            </div>
            <div
              className="mt-1 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <span className="truncate">
                {r.landed && (
                  <>
                    <span style={{ color: win ? 'var(--color-win)' : 'var(--color-lose)' }}>
                      {r.landed === 'heads' ? '⬤' : '○'} {r.landed}
                    </span>
                    {' · '}
                  </>
                )}
                {fmtAlgo(r.betMicroalgo, 2)} bet · vrf #{r.vrfRound} · {relTime(r.resolvedAt, now)}
              </span>
              <span className="flex shrink-0 items-center gap-2 normal-case">
                {explorer && (
                  <a
                    href={explorer}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-opacity hover:opacity-70"
                    style={{ color: 'var(--color-vrf)' }}
                  >
                    tx ↗
                  </a>
                )}
                {r.proofUrl && r.txnId && (
                  <a
                    href={`/proof/${r.txnId}`}
                    className="transition-opacity hover:opacity-70"
                    style={{ color: 'var(--color-text-dim)' }}
                  >
                    card
                  </a>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
