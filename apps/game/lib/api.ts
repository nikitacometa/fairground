/**
 * Typed fetch wrapper for the Fairground API (@fairground/api).
 *
 * BigInt fields arrive as strings (trailing "n" or plain numeric string
 * depending on the endpoint). Callers must parse them with BigInt().
 * The `bigintReviver` from @fairground/types handles the "n"-suffix variant.
 */

import type { ApiResult, BetWire } from '@fairground/types';
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
  netPayoutMicroalgo: bigint | null;
  proofCardUrl: string | null;
  txnId: string | null;
}

export async function fetchBetState(sessionId: string): Promise<BetStateResponse> {
  const wire = await apiFetch<BetWire>(`/games/coinflip/state/${sessionId}`);
  return {
    outcome: wire.outcome,
    netPayoutMicroalgo: wire.netPayoutMicroalgo !== null ? BigInt(wire.netPayoutMicroalgo) : null,
    proofCardUrl: wire.proofCardUrl,
    txnId: wire.txnId,
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
  referrerWallet?: string | null;
}

export interface RecordBetResult {
  sessionId: string;
  betId: string;
}

export async function recordBet(params: RecordBetParams): Promise<RecordBetResult> {
  const body = {
    walletAddress: params.walletAddress,
    txnId: params.txnId,
    vrfRound: params.commitRound.toString(),
    saltHash: toHex(params.saltHash),
    amountMicroalgo: params.betMicroalgo.toString(),
    referrerWallet: params.referrerWallet ?? null,
  };

  const data = await apiFetch<{ betId: string; sessionId: string }>('/games/coinflip/bets', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return { sessionId: data.sessionId, betId: data.betId };
}
