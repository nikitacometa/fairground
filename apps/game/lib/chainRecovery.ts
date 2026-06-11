/**
 * Chain-side flip recovery — read the truth straight from algod/indexer when the client
 * lost track of a flip mid-flight.
 *
 * The motivating incident (2026-06-11): iOS Safari kills in-flight fetches on app-switch to
 * the wallet, so sendFlip threw "Load failed" AFTER the group was already submitted — the
 * flip confirmed on-chain, but the client had no txnId, no recovery record, and showed
 * "your funds were not wagered". These helpers let the client ask the chain directly:
 * "does my wallet have a live flip box?" and "which txn created it?".
 */

import algosdk from 'algosdk';

const MAINNET = process.env['NEXT_PUBLIC_ALGORAND_NETWORK'] === 'mainnet';
const ALGOD_URL = MAINNET
  ? 'https://mainnet-api.algonode.cloud'
  : 'https://testnet-api.algonode.cloud';
const INDEXER_URL = MAINNET
  ? 'https://mainnet-idx.algonode.cloud'
  : 'https://testnet-idx.algonode.cloud';

export interface OnChainFlipBox {
  commitRound: bigint;
  betMicroalgo: bigint;
  saltHashHex: string;
}

function be64(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The wallet's live flip box (`flip:` + pk), or null when there is none. A live box means a
 * flip is committed on-chain and escrowed RIGHT NOW — the strongest possible evidence that
 * funds were wagered, entirely independent of our own backend.
 */
export async function fetchFlipBox(appId: bigint, address: string): Promise<OnChainFlipBox | null> {
  const pk = algosdk.decodeAddress(address).publicKey;
  const name = new Uint8Array(5 + 32);
  name.set([0x66, 0x6c, 0x69, 0x70, 0x3a]); // "flip:"
  name.set(pk, 5);
  const enc = encodeURIComponent(bytesToB64(name));
  const res = await fetch(`${ALGOD_URL}/v2/applications/${appId.toString()}/box?name=b64:${enc}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`algod box read returned ${res.status}`);
  const body = (await res.json()) as { value: string };
  const value = b64ToBytes(body.value);
  if (value.length < 80) return null;
  return {
    commitRound: be64(value.subarray(0, 8)),
    betMicroalgo: be64(value.subarray(8, 16)),
    saltHashHex: Array.from(value.subarray(16, 48), (b) => b.toString(16).padStart(2, '0')).join(
      '',
    ),
  };
}

/**
 * The flip() txn that created the wallet's current box. commit = ceil8(confirmed + 8), so the
 * flip confirmed within [commit−16, commit]; in that window the only appl SENT by the player
 * to this app is the flip itself. Null on indexer lag — the caller then falls back to waiting
 * for the keeper's orphan sweep to register the flip server-side.
 */
export async function findFlipTxnId(
  appId: bigint,
  address: string,
  commitRound: bigint,
): Promise<string | null> {
  const minRound = commitRound > 16n ? commitRound - 16n : 0n;
  const url =
    `${INDEXER_URL}/v2/transactions?address=${address}&address-role=sender` +
    `&application-id=${appId.toString()}&tx-type=appl` +
    `&min-round=${minRound.toString()}&max-round=${commitRound.toString()}&limit=10`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const body = (await res.json()) as { transactions?: Array<{ id?: string; sender?: string }> };
  const txn = (body.transactions ?? []).find((t) => t.sender === address && t.id);
  return txn?.id ?? null;
}

/**
 * Errors that mean "the network path died, the transaction's fate is UNKNOWN" — after these
 * the client must check the chain before making any claim about the player's funds.
 * (iOS Safari surfaces killed fetches as the famously unhelpful "Load failed".)
 */
export function isIndeterminateNetworkError(message: string): boolean {
  return /load failed|failed to fetch|network ?(error|request)|timed? ?out|connection|socket hang|aborted/i.test(
    message,
  );
}
