/**
 * VRF beacon utilities for the Applied Blockchain randomness beacon on Algorand.
 *
 * Mainnet app ID 947957720 confirmed live 2026-05-30 (64 global-state slots,
 * creator YOVFLARZNWGKV7DAIHNK66HVYYJGYFQQIUAGWHOAMOPNOFSI5MR54ZCGMQ).
 * Testnet app ID 110096026 confirmed same bytecode.
 *
 * The beacon exposes ARC-4 ABI methods:
 *   must_get(uint64,byte[])byte[]  -- panics if round not stored (selector 0x47c20c23)
 *   get(uint64,byte[])byte[]       -- returns empty bytes if round not stored (0x189392c5)
 *
 * Beacon stores last 189 outputs (~70 minutes of Algorand history).
 * Keeper SLA: resolve all sessions within 60 minutes of commit_round passing.
 *
 * Commit-reveal:
 *   flip() stores commit_round = current_round + 8 (+8 for beacon ceil8 semantics).
 *   resolve() calls must_get(commit_round, b"") after commit_round + 2 passes.
 *   beacon_output = arc4_result.bytes.slice(2)  // skip 2-byte ARC-4 length prefix
 *   outcome = sha256(beacon_output + salt_hash)[0] % 2
 */

import { createHash } from 'node:crypto';
import algosdk from 'algosdk';

/** Mainnet VRF beacon app ID (Applied Blockchain). Confirmed live 2026-05-30. */
export const MAINNET_BEACON_APP_ID = 947_957_720n;

/** Testnet VRF beacon app ID. Confirmed same bytecode as mainnet. */
export const TESTNET_BEACON_APP_ID = 110_096_026n;

/** Rounds to add when committing a bet. Must be >= 8 for beacon ceil8 semantics. */
export const BEACON_COMMIT_DELAY = 8n;

/**
 * Extra rounds to wait before calling resolve (beacon propagation buffer).
 * The beacon writes a proof up to 3 rounds after its ceil-8 target round, so 4
 * covers the worst case. Must match BEACON_SETTLE_BUFFER in coinflip/contract.py.
 */
export const BEACON_SETTLE_BUFFER = 4n;

/**
 * Calculate the target beacon round for a bet placed at the given round.
 *
 * @param currentRound - Algorand round when flip() is submitted
 * @param delay        - Commit delay (default BEACON_COMMIT_DELAY = 8n)
 */
export function targetBeaconRound(currentRound: bigint, delay = BEACON_COMMIT_DELAY): bigint {
  return currentRound + delay;
}

/**
 * True if the beacon round has settled enough for resolve() to succeed.
 * resolve() requires: current_round >= commit_round + BEACON_SETTLE_BUFFER
 */
export function isBeaconRoundSettled(
  commitRound: bigint,
  currentRound: bigint,
  buffer = BEACON_SETTLE_BUFFER,
): boolean {
  return currentRound >= commitRound + buffer;
}

/**
 * Poll algod until the given round is reached.
 * Used by the keeper before calling resolve().
 *
 * @param client      - algosdk Algodv2 instance
 * @param targetRound - Wait until algod reports this round
 */
export async function waitForBeaconRound(
  client: algosdk.Algodv2,
  targetRound: bigint,
): Promise<void> {
  const status = await client.status().do();
  // algosdk v3: NodeStatusResponse.lastRound is already a bigint (camelCase).
  const current = status.lastRound;
  if (current >= targetRound) return;
  await client.statusAfterBlock(Number(targetRound)).do();
}

/**
 * Derive the coin flip outcome from raw beacon bytes and the player's salt hash.
 * Mirrors the on-chain logic in CoinflipContract.resolve().
 *
 * @param beaconOutputRaw32 - 32 raw bytes from the beacon (ARC-4 length prefix stripped)
 * @param saltHashHex       - 64-character hex string of the player's salt hash
 * @returns 'heads' (win) or 'tails' (loss)
 */
export function deriveFlipOutcome(
  beaconOutputRaw32: Uint8Array,
  saltHashHex: string,
): 'heads' | 'tails' {
  if (beaconOutputRaw32.length !== 32) {
    throw new Error(`beacon output must be 32 bytes, got ${beaconOutputRaw32.length}`);
  }
  const saltBytes = Buffer.from(saltHashHex, 'hex');
  const combined = new Uint8Array(64);
  combined.set(beaconOutputRaw32, 0);
  combined.set(saltBytes, 32);
  // Node crypto sha256 -- matches op.sha256 in AVM
  const hash = createHash('sha256').update(combined).digest();
  return hash[0] % 2 === 1 ? 'heads' : 'tails';
}

/**
 * Beacon app ID for the given network.
 */
export function beaconAppId(network: 'mainnet' | 'testnet'): bigint {
  return network === 'mainnet' ? MAINNET_BEACON_APP_ID : TESTNET_BEACON_APP_ID;
}
