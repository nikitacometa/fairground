'use client';

import { useWallet } from '@txnlab/use-wallet-react';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { fetchReferralStats, type ReferralStatsResult } from '../lib/api';

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Format microALGO without going through Number (amounts are bigint; precision must hold).
function formatAlgo(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').slice(0, 4);
  return `${whole.toString()}.${frac}`;
}

type LoadState = 'loading' | 'loaded' | 'error';

/**
 * Refer-&-earn panel. The contract already pays a `?ref=<wallet>` referrer 1% of every stake on
 * resolve, but referrers had no way to discover or track it. This surfaces the player's own
 * referral link (copyable) and their recorded on-chain earnings, turning a dormant mechanic into a
 * visible loop. Rendered only once a wallet is connected; SSR-safe via a mounted gate (#418).
 */
export function ReferralPanel(): ReactElement | null {
  const { activeAccount } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<ReferralStatsResult | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const address = activeAccount?.address ?? null;

  useEffect(() => {
    if (!address) {
      setStats(null);
      setLoad('loading');
      return;
    }
    let cancelled = false;
    setLoad('loading');
    void fetchReferralStats(address)
      .then((s) => {
        if (cancelled) return;
        setStats(s);
        setLoad('loaded');
      })
      .catch(() => {
        if (cancelled) return;
        // Don't fabricate a zero balance from a failed fetch — surface it as unavailable.
        setStats(null);
        setLoad('error');
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const link = address ? `${window.location.origin}/?ref=${address}` : '';

  const copy = useCallback(() => {
    if (!link) return;
    const clip = navigator.clipboard;
    if (!clip?.writeText) return; // no clipboard API (insecure context) — link stays visible
    void clip.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {
        // permission denied — link is still on screen to copy manually
      },
    );
  }, [link]);

  if (!mounted || !address) return null;

  return (
    <section
      className="w-full max-w-lg border p-4 font-mono"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div
        className="mb-2 text-[11px] uppercase tracking-[0.25em]"
        style={{ color: 'var(--color-primary)' }}
      >
        ◇ refer &amp; earn 1%
      </div>
      <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--color-text-dim)' }}>
        Your link earns <strong>1% of every stake</strong> your recruits flip — paid on-chain by the
        contract, win or lose.
      </p>

      <div className="flex items-stretch gap-2">
        <code
          className="flex-1 truncate border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          title={link}
        >
          /?ref={shortAddr(address)}
        </code>
        <button
          onClick={copy}
          className="border px-3 py-2 text-xs uppercase tracking-wide transition-opacity hover:opacity-80"
          style={{
            borderColor: 'var(--color-primary)',
            color: 'var(--color-primary)',
            background: 'var(--color-primary-dim)',
          }}
        >
          {copied ? 'copied' : 'copy link'}
        </button>
      </div>

      <div
        className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] uppercase tracking-[0.2em]"
        style={{ color: 'var(--color-text-dim)' }}
      >
        {load === 'error' ? (
          <span style={{ color: 'var(--color-text-muted)' }}>earnings unavailable</span>
        ) : load === 'loading' ? (
          <span style={{ color: 'var(--color-text-muted)' }}>loading…</span>
        ) : (
          <>
            <span>
              <span style={{ color: 'var(--color-win)' }}>
                {formatAlgo(stats?.totalEarnedMicroalgo ?? 0n)} ALGO
              </span>{' '}
              earned
            </span>
            <span>{stats?.referredCount ?? 0} flips referred</span>
          </>
        )}
      </div>
    </section>
  );
}
