import { describe, expect, it } from 'vitest';
import algosdk from 'algosdk';
import { parseFlipBox } from './flip-box.js';

// Layout pinned by the contract: name = "flip:" + pk32, value = vrf_round8 + bet8 +
// salt_hash32 + referrer32. A drift here would silently break the sweep, so pin it.

const PLAYER = 'FLEXED4QKMIX6W5QQR3QXUN2TZ6G7YEL2BHUTCLGCGVLHHZ2T6IKGNIKPU';

function be64(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function makeBox(opts?: { referrer?: string }): { name: Uint8Array; value: Uint8Array } {
  const pk = algosdk.decodeAddress(PLAYER).publicKey;
  const name = new Uint8Array([...Buffer.from('flip:'), ...pk]);
  const salt = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const ref = opts?.referrer ? algosdk.decodeAddress(opts.referrer).publicKey : new Uint8Array(32);
  const value = new Uint8Array([...be64(62042320n), ...be64(20_000_000n), ...salt, ...ref]);
  return { name, value };
}

describe('parseFlipBox', () => {
  it('decodes the real 80-byte layout', () => {
    const { name, value } = makeBox();
    const box = parseFlipBox(name, value);
    expect(box).not.toBeNull();
    expect(box?.player).toBe(PLAYER);
    expect(box?.vrfRound).toBe(62042320n);
    expect(box?.betMicroalgo).toBe(20_000_000n);
    expect(box?.saltHashHex).toBe(Buffer.from(value.subarray(16, 48)).toString('hex'));
    expect(box?.referrer).toBeNull(); // zero address = no referrer
  });

  it('decodes a non-zero referrer', () => {
    const referrer = 'COOKHRI3CKNHU6QOSQHG3YHPTYSIUEL5VL5COCABTIGVRZ574EYFITJNDA';
    const { name, value } = makeBox({ referrer });
    expect(parseFlipBox(name, value)?.referrer).toBe(referrer);
  });

  it.each([
    { label: 'wrong prefix', mutate: (n: Uint8Array) => (n[0] = 0x78) },
    { label: 'short name', mutate: (n: Uint8Array) => n.subarray(0, 20) },
  ])('rejects $label', ({ mutate }) => {
    const { name, value } = makeBox();
    const mutated = mutate(name);
    expect(parseFlipBox(mutated instanceof Uint8Array ? mutated : name, value)).toBeNull();
  });

  it('rejects a truncated value', () => {
    const { name, value } = makeBox();
    expect(parseFlipBox(name, value.subarray(0, 79))).toBeNull();
  });
});
