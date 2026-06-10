/**
 * Typed fetch wrapper for the Fairground API (@fairground/api).
 *
 * BigInt fields arrive as strings (trailing "n" or plain numeric string
 * depending on the endpoint). Callers must parse them with BigInt().
 * The `bigintReviver` from @fairground/types handles the "n"-suffix variant.
 */

import type { ApiResult } from '@fairground/types';
import { bigintReviver } from '@fairground/types';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? '';

class ApiError extends Error {
  constructor(
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  const parsed = JSON.parse(text, bigintReviver) as ApiResult<T>;

  if (!parsed.ok) {
    throw new ApiError(parsed.code, parsed.error);
  }

  return parsed.data;
}

// ---------------------------------------------------------------------------
// Bet session state
// ---------------------------------------------------------------------------

export interface BetStateResponse {
  outcome: import('@fairground/types').BetOutcome;
  // Session lifecycle state. 'failed' and 'beacon_expired' are terminal-without-a-result:
  // the flip won't auto-resolve, so the UI stops polling and points the player at the refund.
  state: import('@fairground/types').SessionState;
  netPayoutMicroalgo: bigint | null;
  proofCardUrl: string | null;
  txnId: string | null;
}

interface BetStateWire {
  state: import('@fairground/types').SessionState;
  outcome: import('@fairground/types').BetOutcome;
  netPayoutMicroalgo: string | null;
  proofCardUrl: string | null;
  txnId: string | null;
}

// The keeper stores proofCardUrl as a root-relative path (`/proof/:txnId`). The proof PNG
// lives on the API origin, not the game origin, so an <img src> or share URL must be made
// absolute against BASE_URL — otherwise it resolves to app.fairground.quest/proof/... (404).
function absoluteProofUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  return `${BASE_URL}${url}`;
}

export async function fetchBetState(sessionId: string): Promise<BetStateResponse> {
  const wire = await apiFetch<BetStateWire>(`/games/coinflip/state/${sessionId}`);
  return {
    outcome: wire.outcome,
    state: wire.state,
    netPayoutMicroalgo: wire.netPayoutMicroalgo !== null ? BigInt(wire.netPayoutMicroalgo) : null,
    proofCardUrl: absoluteProofUrl(wire.proofCardUrl),
    txnId: wire.txnId,
  };
}

// ---------------------------------------------------------------------------
// Active-flip recovery
//
// On load the UI asks the API whether this wallet has a flip in progress (resume polling)
// or one that resolved while the player was away (show the result) — server-side truth, so a
// reload / different device / cleared localStorage never loses the flip from the UI.
// ---------------------------------------------------------------------------

export type ActiveFlipStatus = 'active' | 'recent' | 'none';

export interface ActiveFlipResult {
  status: ActiveFlipStatus;
  sessionId: string | null;
  commitRound: bigint | null;
  playerPick: 'heads' | 'tails' | null;
  outcome: import('@fairground/types').BetOutcome;
  netPayoutMicroalgo: bigint | null;
  proofCardUrl: string | null;
  txnId: string | null;
}

interface ActiveFlipWire {
  status: ActiveFlipStatus;
  sessionId?: string;
  commitRound?: string;
  playerPick?: 'heads' | 'tails' | null;
  outcome?: import('@fairground/types').BetOutcome;
  netPayoutMicroalgo?: string | null;
  proofCardUrl?: string | null;
  txnId?: string | null;
}

export async function fetchActiveFlip(address: string): Promise<ActiveFlipResult> {
  const wire = await apiFetch<ActiveFlipWire>(`/games/coinflip/active/${address}`);
  return {
    status: wire.status,
    sessionId: wire.sessionId ?? null,
    commitRound: wire.commitRound != null ? BigInt(wire.commitRound) : null,
    playerPick: wire.playerPick ?? null,
    outcome: wire.outcome ?? 'pending',
    netPayoutMicroalgo: wire.netPayoutMicroalgo != null ? BigInt(wire.netPayoutMicroalgo) : null,
    proofCardUrl: absoluteProofUrl(wire.proofCardUrl ?? null),
    txnId: wire.txnId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Bet recording
//
// The flip group is built, signed, and submitted client-side via @fairground/sdk
// (see lib/coinflip.ts). Once it is confirmed on-chain, the client calls this to
// register the pending session so the keeper resolves it and the UI can poll state.
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface RecordBetParams {
  walletAddress: string;
  /** Confirmed flip() app-call transaction ID. */
  txnId: string;
  /** Committed VRF beacon round returned by flip(). */
  commitRound: bigint;
  /** 32-byte SHA-256 salt hash (stored on-chain; recorded here as hex). */
  saltHash: Uint8Array;
  /** Bet amount in microALGO, exclusive of the box MBR. */
  betMicroalgo: bigint;
  /** The side the player called — recorded so the proof card shows the real pick. */
  pick: 'heads' | 'tails';
  referrerWallet?: string | null;
}

export interface RecordBetResult {
  sessionId: string;
  betId: string;
}

// ---------------------------------------------------------------------------
// Referral earnings
// ---------------------------------------------------------------------------

export interface ReferralStatsResult {
  referredCount: number;
  totalEarnedMicroalgo: bigint;
  referredVolumeMicroalgo: bigint;
}

export async function fetchReferralStats(address: string): Promise<ReferralStatsResult> {
  const data = await apiFetch<{
    referredCount: number;
    totalEarnedMicroalgo: string;
    referredVolumeMicroalgo: string;
  }>(`/referrals/${address}`);
  return {
    referredCount: data.referredCount,
    totalEarnedMicroalgo: BigInt(data.totalEarnedMicroalgo),
    referredVolumeMicroalgo: BigInt(data.referredVolumeMicroalgo),
  };
}

/** The wallet's current live win streak, computed server-side (authoritative across devices). */
export async function fetchStreak(address: string): Promise<number> {
  const data = await apiFetch<{ streak: number }>(`/games/coinflip/streak/${address}`);
  return data.streak;
}

export async function recordBet(params: RecordBetParams): Promise<RecordBetResult> {
  const body = {
    walletAddress: params.walletAddress,
    txnId: params.txnId,
    vrfRound: params.commitRound.toString(),
    saltHash: toHex(params.saltHash),
    amountMicroalgo: params.betMicroalgo.toString(),
    playerPick: params.pick,
    referrerWallet: params.referrerWallet ?? null,
  };

  // The flip is already confirmed on-chain by the time we get here, so a transient API
  // failure must not strand it untracked. Retry a few times before surfacing the error.
  // A unique index on txnId guarantees retries never create a duplicate bet; in the rare
  // case the first insert succeeded but its response was lost, the retry hits that index
  // and surfaces an error — safe (the session still exists and the keeper resolves it).
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await apiFetch<{ betId: string; sessionId: string }>('/games/coinflip/bets', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { sessionId: data.sessionId, betId: data.betId };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('failed to record bet');
}
