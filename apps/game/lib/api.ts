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
// Bet submission (temporary: server builds unsigned txns until client is generated)
// ---------------------------------------------------------------------------

export interface SubmitBetParams {
  walletAddress: string;
  betMicroalgo: bigint;
  totalPayment: bigint;
  saltHash: Uint8Array;
  coinflipAppId: bigint;
  /** Player's chosen side — sent to the API so the server can record and verify the outcome. */
  pick: 'heads' | 'tails';
}

export interface SubmitBetResult {
  /** base64-encoded unsigned transaction group, ready to pass to signTransactions */
  encodedTxns: Uint8Array[];
  sessionId: string;
}

export async function submitBet(params: SubmitBetParams): Promise<SubmitBetResult> {
  const body = {
    walletAddress: params.walletAddress,
    betMicroalgo: params.betMicroalgo.toString(),
    totalPayment: params.totalPayment.toString(),
    saltHash: Array.from(params.saltHash),
    coinflipAppId: params.coinflipAppId.toString(),
    pick: params.pick,
  };

  const res = await apiFetch<{ encodedTxns: number[][]; sessionId: string }>(
    '/games/coinflip/prepare',
    { method: 'POST', body: JSON.stringify(body) },
  );

  return {
    encodedTxns: res.encodedTxns.map((arr) => new Uint8Array(arr)),
    sessionId: res.sessionId,
  };
}
