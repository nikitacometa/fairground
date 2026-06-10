'use client';

/**
 * usePotState — polls GET /jackpot (with optional wallet address) every 10 s.
 *
 * Returns null while the first load is in flight, { configured: false } when
 * JACKPOT_APP_ID === 0n (503 jackpot_not_configured), or { configured: true, data }
 * once the first successful response lands.
 *
 * Re-exported from here so PotBar and /pot page both avoid duplicating the fetch
 * logic; the hook is the single source of truth for pot state in the frontend.
 */

import { useEffect, useRef, useState } from 'react';

// -------------------------------------------------------------------------
// Types — mirror the frozen API contract in docs/design/fairjackpot-v1.md §4
// -------------------------------------------------------------------------

export interface PotParams {
  jackpotBps: number;
  winnerBps: number;
  runnerBps: number;
  runnerCount: number;
  backstopMicroalgo: string;
}

export interface PendingDraw {
  epochId: string;
  commitRound: string;
  potMicroalgo: string;
  totalTickets: string;
}

export interface DrawWinner {
  address: string;
  nfd: string | null;
  payoutMicroalgo: string;
}

export interface LastDraw {
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

export interface PotState {
  potMicroalgo: string;
  epochId: string;
  nextDrawAt: string; // ISO — unix ts epoch_close_ts converted to ISO by the API
  totalTickets: string;
  totalEntries: string;
  rolloverMicroalgo: string;
  paused: boolean;
  pendingDraw: PendingDraw | null;
  params: PotParams;
  lastDraw: LastDraw | null;
  myTickets?: string;
  myWageredThisEpoch?: string;
}

export type PotStateResult = { configured: false } | { configured: true; data: PotState };

const POLL_MS = 10_000;

// Fallback applied to state when an API call does not return usable data.
// `prev === null` guard: only overwrite the initial null (first load), never replace known-good
// data with "not configured" on a transient network hiccup.
function degradeFallback(prev: PotStateResult | null): PotStateResult {
  return prev === null ? { configured: false } : prev;
}

/**
 * @param address — when provided, the API appends ?address= and returns myTickets / myWageredThisEpoch.
 */
export function usePotState(address?: string | null): PotStateResult | null {
  const [result, setResult] = useState<PotStateResult | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? '';
    cancelRef.current = false;

    const load = async (): Promise<void> => {
      try {
        const url = address
          ? `${base}/jackpot?address=${encodeURIComponent(address)}`
          : `${base}/jackpot`;
        const res = await fetch(url);
        if (cancelRef.current) return;

        if (res.status === 503) {
          const body = (await res.json().catch(() => ({}))) as { code?: string };
          if (cancelRef.current) return;
          if (body.code === 'jackpot_not_configured') {
            setResult({ configured: false });
          } else {
            // Other 503 (maintenance). Degrade on first load; keep good data on retries.
            setResult(degradeFallback);
          }
          return;
        }

        if (!res.ok) {
          // 404 = route not deployed yet; any non-2xx = unavailable.
          setResult(degradeFallback);
          return;
        }

        const json = (await res.json()) as { ok: boolean; data?: PotState };
        if (cancelRef.current) return;
        if (json.ok && json.data) {
          setResult({ configured: true, data: json.data });
        } else {
          setResult(degradeFallback);
        }
      } catch {
        // Network error — degrade to not-configured on first load; keep last state on retries.
        setResult(degradeFallback);
      }
    };

    void load();
    const id = setInterval(() => void load(), POLL_MS);

    return () => {
      cancelRef.current = true;
      clearInterval(id);
    };
  }, [address]);

  return result;
}
