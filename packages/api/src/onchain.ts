/**
 * Shared on-chain config readers for coinflip and jackpot contracts.
 *
 * Both fetchers apply a stale-last-good Redis pattern: on live algod success the
 * result is written to a permanent (no-TTL) key; on algod failure the stale value is
 * returned instead of null. This eliminates the /stats nulls regression that appeared
 * whenever the 4s AbortSignal timeout fired (nulls for the rest of that 30s cache window).
 *
 * Coinflip v1 contracts do not have `house_edge_bps`, `referral_bps`, or `jackpot_bps`
 * in their global state — those keys come back `undefined` on v1; callers fall back to
 * static defaults so v1 does not regress.
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { env } from './env.js';

interface AlgodGlobalStateEntry {
  key: string;
  value: { type: number; uint?: number | string; bytes?: string };
}

function decodeUintState(entries: AlgodGlobalStateEntry[]): Map<string, bigint> {
  const state = new Map<string, bigint>();
  for (const e of entries) {
    const key = Buffer.from(e.key, 'base64').toString('utf8');
    if (e.value.type === 2) {
      state.set(key, BigInt(e.value.uint ?? 0));
    }
  }
  return state;
}

async function fetchRawGlobalState(
  appId: bigint,
  logger: Logger,
): Promise<Map<string, bigint> | null> {
  try {
    const headers: Record<string, string> = env.ALGOD_TOKEN
      ? { 'X-Algo-API-Token': env.ALGOD_TOKEN }
      : {};
    const res = await fetch(`${env.ALGOD_URL}/v2/applications/${appId}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, appId: appId.toString() }, 'algod app lookup failed');
      return null;
    }
    const body = (await res.json()) as {
      params?: { 'global-state'?: AlgodGlobalStateEntry[] };
    };
    return decodeUintState(body.params?.['global-state'] ?? []);
  } catch (err) {
    logger.warn({ err, appId: appId.toString() }, 'algod app fetch failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Coinflip config
// ---------------------------------------------------------------------------

export interface CoinflipConfig {
  paused: boolean;
  minBetMicroalgo: string;
  maxBetMicroalgo: string;
  totalBetsOnchain: string;
  totalVolumeOnchainMicroalgo: string;
  /** v2+ only; undefined on v1 (key absent from global state). Callers fall back to 300. */
  houseEdgeBps: bigint | undefined;
  /** v2+ only; undefined on v1. Callers fall back to 100. */
  referralBps: bigint | undefined;
  /** v2+ only; undefined on v1. Callers treat null as jackpot not enabled. */
  jackpotBps: bigint | undefined;
}

function serializeCoinflipConfig(c: CoinflipConfig): string {
  return JSON.stringify({
    paused: c.paused,
    minBetMicroalgo: c.minBetMicroalgo,
    maxBetMicroalgo: c.maxBetMicroalgo,
    totalBetsOnchain: c.totalBetsOnchain,
    totalVolumeOnchainMicroalgo: c.totalVolumeOnchainMicroalgo,
    houseEdgeBps: c.houseEdgeBps != null ? c.houseEdgeBps.toString() : null,
    referralBps: c.referralBps != null ? c.referralBps.toString() : null,
    jackpotBps: c.jackpotBps != null ? c.jackpotBps.toString() : null,
  });
}

/** Safely coerce an `unknown` JSON field to string; returns `fallback` for objects/undefined. */
function safeStr(v: unknown, fallback = '0'): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toString();
  return fallback;
}

function deserializeCoinflipConfig(raw: string): CoinflipConfig {
  const p = JSON.parse(raw) as Record<string, unknown>;
  const houseEdgeBpsRaw = p['houseEdgeBps'];
  const referralBpsRaw = p['referralBps'];
  const jackpotBpsRaw = p['jackpotBps'];
  return {
    paused: Boolean(p['paused']),
    minBetMicroalgo: safeStr(p['minBetMicroalgo']),
    maxBetMicroalgo: safeStr(p['maxBetMicroalgo']),
    totalBetsOnchain: safeStr(p['totalBetsOnchain']),
    totalVolumeOnchainMicroalgo: safeStr(p['totalVolumeOnchainMicroalgo']),
    houseEdgeBps: houseEdgeBpsRaw != null ? BigInt(safeStr(houseEdgeBpsRaw)) : undefined,
    referralBps: referralBpsRaw != null ? BigInt(safeStr(referralBpsRaw)) : undefined,
    jackpotBps: jackpotBpsRaw != null ? BigInt(safeStr(jackpotBpsRaw)) : undefined,
  };
}

export async function fetchCoinflipConfig(
  redis: Redis,
  logger: Logger,
): Promise<CoinflipConfig | null> {
  const staleKey = 'onchain:coinflip:lastgood';
  const state = await fetchRawGlobalState(env.COINFLIP_APP_ID, logger);
  if (state !== null) {
    const config: CoinflipConfig = {
      paused: (state.get('paused') ?? 0n) === 1n,
      minBetMicroalgo: (state.get('min_bet') ?? 0n).toString(),
      maxBetMicroalgo: (state.get('max_bet') ?? 0n).toString(),
      totalBetsOnchain: (state.get('total_bets') ?? 0n).toString(),
      totalVolumeOnchainMicroalgo: (state.get('total_volume') ?? 0n).toString(),
      houseEdgeBps: state.get('house_edge_bps'),
      referralBps: state.get('referral_bps'),
      jackpotBps: state.get('jackpot_bps'),
    };
    await redis.set(staleKey, serializeCoinflipConfig(config));
    return config;
  }
  try {
    const cached = await redis.get(staleKey);
    if (cached) {
      logger.debug('coinflip config: stale-cache hit after algod failure');
      return deserializeCoinflipConfig(cached);
    }
  } catch (cacheErr) {
    logger.warn({ err: cacheErr }, 'coinflip stale cache read failed');
  }
  return null;
}

// ---------------------------------------------------------------------------
// FairJackpot (Daily Pot) on-chain state
// ---------------------------------------------------------------------------

export interface JackpotOnchainState {
  epochId: bigint;
  epochCloseTs: bigint;
  epochTotalTickets: bigint;
  epochEntryCount: bigint;
  potBalance: bigint;
  lastRollover: bigint;
  paused: boolean;
  pendingEpoch: bigint;
  pendingCommitRound: bigint;
  pendingPot: bigint;
  pendingTotalTickets: bigint;
  winnerBps: bigint;
  runnerBps: bigint;
  runnerCount: bigint;
  backstopMicroalgo: bigint;
}

function serializeJackpotState(s: JackpotOnchainState): string {
  return JSON.stringify({
    epochId: s.epochId.toString(),
    epochCloseTs: s.epochCloseTs.toString(),
    epochTotalTickets: s.epochTotalTickets.toString(),
    epochEntryCount: s.epochEntryCount.toString(),
    potBalance: s.potBalance.toString(),
    lastRollover: s.lastRollover.toString(),
    paused: s.paused,
    pendingEpoch: s.pendingEpoch.toString(),
    pendingCommitRound: s.pendingCommitRound.toString(),
    pendingPot: s.pendingPot.toString(),
    pendingTotalTickets: s.pendingTotalTickets.toString(),
    winnerBps: s.winnerBps.toString(),
    runnerBps: s.runnerBps.toString(),
    runnerCount: s.runnerCount.toString(),
    backstopMicroalgo: s.backstopMicroalgo.toString(),
  });
}

function deserializeJackpotState(raw: string): JackpotOnchainState {
  const p = JSON.parse(raw) as Record<string, unknown>;
  const b = (key: string, fallback = '0'): bigint => BigInt(safeStr(p[key] ?? fallback));
  return {
    epochId: b('epochId', '1'),
    epochCloseTs: b('epochCloseTs'),
    epochTotalTickets: b('epochTotalTickets'),
    epochEntryCount: b('epochEntryCount'),
    potBalance: b('potBalance'),
    lastRollover: b('lastRollover'),
    paused: Boolean(p['paused']),
    pendingEpoch: b('pendingEpoch'),
    pendingCommitRound: b('pendingCommitRound'),
    pendingPot: b('pendingPot'),
    pendingTotalTickets: b('pendingTotalTickets'),
    winnerBps: b('winnerBps', '7000'),
    runnerBps: b('runnerBps', '400'),
    runnerCount: b('runnerCount', '5'),
    backstopMicroalgo: b('backstopMicroalgo', '25000000'),
  };
}

export async function fetchJackpotState(
  redis: Redis,
  logger: Logger,
): Promise<JackpotOnchainState | null> {
  if (env.JACKPOT_APP_ID === 0n) return null;
  const staleKey = 'onchain:jackpot:lastgood';
  const state = await fetchRawGlobalState(env.JACKPOT_APP_ID, logger);
  if (state !== null) {
    const js: JackpotOnchainState = {
      epochId: state.get('epoch_id') ?? 1n,
      epochCloseTs: state.get('epoch_close_ts') ?? 0n,
      epochTotalTickets: state.get('epoch_total_tickets') ?? 0n,
      epochEntryCount: state.get('epoch_entry_count') ?? 0n,
      potBalance: state.get('pot_balance') ?? 0n,
      lastRollover: state.get('last_rollover') ?? 0n,
      paused: (state.get('paused') ?? 0n) === 1n,
      pendingEpoch: state.get('pending_epoch') ?? 0n,
      pendingCommitRound: state.get('pending_commit_round') ?? 0n,
      pendingPot: state.get('pending_pot') ?? 0n,
      pendingTotalTickets: state.get('pending_total_tickets') ?? 0n,
      winnerBps: state.get('winner_bps') ?? 7000n,
      runnerBps: state.get('runner_bps') ?? 400n,
      runnerCount: state.get('runner_count') ?? 5n,
      backstopMicroalgo: state.get('backstop_microalgo') ?? 25_000_000n,
    };
    await redis.set(staleKey, serializeJackpotState(js));
    return js;
  }
  try {
    const cached = await redis.get(staleKey);
    if (cached) {
      logger.debug('jackpot state: stale-cache hit after algod failure');
      return deserializeJackpotState(cached);
    }
  } catch (cacheErr) {
    logger.warn({ err: cacheErr }, 'jackpot stale cache read failed');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Algorand address utilities (no algosdk dependency needed here)
// ---------------------------------------------------------------------------

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32DecodeBytes(encoded: string): Uint8Array | null {
  let buf = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const ch of encoded.replace(/=+$/, '').toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx === -1) return null;
    buf = (buf << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buf >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Decode an Algorand address to its 32-byte raw public key.
 * Validates the checksum via sha512-256. Returns null on any error.
 */
export function decodeAlgoAddress(addr: string): Uint8Array | null {
  if (addr.length !== 58) return null;
  const decoded = base32DecodeBytes(addr);
  if (!decoded || decoded.length !== 36) return null;
  const pk = decoded.slice(0, 32);
  const checksum = decoded.slice(32);
  const hash = createHash('sha512-256').update(pk).digest();
  const expected = hash.slice(-4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) return null;
  }
  return pk;
}
