/**
 * Flip-box decoding — pure helpers with no env/db imports, shared by the orphan sweep and
 * its tests. Layout pinned by the contract: name = "flip:" + 32-byte player pk, value =
 * vrf_round(8) + bet(8) + salt_hash(32) + referrer(32).
 */

import algosdk from 'algosdk';

export const FLIP_PREFIX = Buffer.from('flip:');

export interface FlipBoxState {
  player: string;
  vrfRound: bigint;
  betMicroalgo: bigint;
  saltHashHex: string;
  referrer: string | null;
}

export function be64(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/**
 * Decode a flip box. Returns null for anything that doesn't match the layout — the sweep
 * must never crash the keeper over a malformed/foreign box.
 */
export function parseFlipBox(name: Uint8Array, value: Uint8Array): FlipBoxState | null {
  if (name.length !== FLIP_PREFIX.length + 32) return null;
  if (!Buffer.from(name.subarray(0, FLIP_PREFIX.length)).equals(FLIP_PREFIX)) return null;
  if (value.length < 80) return null;
  const refPk = value.subarray(48, 80);
  return {
    player: algosdk.encodeAddress(name.subarray(FLIP_PREFIX.length)),
    vrfRound: be64(value.subarray(0, 8)),
    betMicroalgo: be64(value.subarray(8, 16)),
    saltHashHex: Buffer.from(value.subarray(16, 48)).toString('hex'),
    referrer: refPk.every((b) => b === 0) ? null : algosdk.encodeAddress(refPk),
  };
}
