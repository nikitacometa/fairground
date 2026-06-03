import { describe, it, expect, vi } from 'vitest';
import { resolveNfds, resolveNfd } from './resolve.js';

const ADDR = 'R2BPRCZNWG6NZPZFZP36DBSDPKSGUFMWVBHHBHOLZR65X2E5ZZLC4PHSSQ';
const OTHER = 'COOKHRI3CKNHU6QOSQHG3YHPTYSIUEL5VL5COCABTIGVRZ574EYFITJNDA';

/** A fresh 200 Response per call — bodies are single-read, so never reuse one instance. */
function okFetch(body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  );
}

describe('resolveNfds', () => {
  it('returns a verified record when the address is present in caAlgo[]', async () => {
    const fetchImpl = okFetch({
      [ADDR]: { name: 'defi.nfdomains.algo', expired: false, caAlgo: [ADDR] },
    });
    const map = await resolveNfds([ADDR], { fetchImpl });
    expect(map.get(ADDR)).toEqual({
      name: 'defi.nfdomains.algo',
      address: ADDR,
      verified: true,
      avatar: undefined,
    });
  });

  it('extracts the avatar URL from properties.userDefined when present', async () => {
    const fetchImpl = okFetch({
      [ADDR]: {
        name: 'a.algo',
        caAlgo: [ADDR],
        properties: { userDefined: { avatar: 'https://images.nf.domains/avatar/x' } },
      },
    });
    const map = await resolveNfds([ADDR], { fetchImpl });
    expect(map.get(ADDR)?.avatar).toBe('https://images.nf.domains/avatar/x');
  });

  it('returns null for a name the address has NOT verified (caAlgo mismatch)', async () => {
    const fetchImpl = okFetch({ [ADDR]: { name: 'squat.algo', caAlgo: ['SOMEONEELSE'] } });
    const map = await resolveNfds([ADDR], { fetchImpl });
    expect(map.get(ADDR)).toBeNull();
  });

  it('returns null for an expired NFD even when caAlgo matches', async () => {
    const fetchImpl = okFetch({ [ADDR]: { name: 'old.algo', expired: true, caAlgo: [ADDR] } });
    const map = await resolveNfds([ADDR], { fetchImpl });
    expect(map.get(ADDR)).toBeNull();
  });

  it('returns null when the address key is absent from the response object', async () => {
    const fetchImpl = okFetch({});
    const map = await resolveNfds([ADDR], { fetchImpl });
    expect(map.get(ADDR)).toBeNull();
  });

  it('returns null on a non-ok response (404 / 429)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{}', { status: 404 })),
    );
    const map = await resolveNfds([ADDR], { fetchImpl });
    expect(map.get(ADDR)).toBeNull();
  });

  it('returns null (never throws) when fetch rejects with a network error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error('ECONNRESET')));
    const map = await resolveNfds([ADDR], { fetchImpl });
    expect(map.get(ADDR)).toBeNull();
  });

  it('resolves a mixed batch: one named, one unnamed', async () => {
    const fetchImpl = okFetch({ [ADDR]: { name: 'defi.algo', caAlgo: [ADDR] } });
    const map = await resolveNfds([ADDR, OTHER], { fetchImpl });
    expect(map.get(ADDR)?.name).toBe('defi.algo');
    expect(map.get(OTHER)).toBeNull();
  });

  it('chunks more than 20 addresses into separate requests', async () => {
    const addrs = Array.from({ length: 25 }, (_, i) => `ADDR${i}`);
    const fetchImpl = okFetch({});
    await resolveNfds(addrs, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('encodes each address as a repeated query param with view=tiny', async () => {
    const fetchImpl = okFetch({});
    await resolveNfds([ADDR], { fetchImpl });
    const input = fetchImpl.mock.calls[0]?.[0];
    expect(typeof input).toBe('string');
    const url = input as string;
    expect(url).toContain(`address=${ADDR}`);
    expect(url).toContain('view=tiny');
  });

  it('deduplicates repeated addresses into a single request and entry', async () => {
    const fetchImpl = okFetch({ [ADDR]: { name: 'd.algo', caAlgo: [ADDR] } });
    const map = await resolveNfds([ADDR, ADDR, ADDR], { fetchImpl });
    expect(map.size).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map and skips fetch entirely for no addresses', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const map = await resolveNfds([], { fetchImpl });
    expect(map.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('resolveNfd', () => {
  it('returns the single resolved record', async () => {
    const fetchImpl = okFetch({ [ADDR]: { name: 'd.algo', caAlgo: [ADDR] } });
    expect((await resolveNfd(ADDR, { fetchImpl }))?.name).toBe('d.algo');
  });

  it('returns null when the address has no NFD', async () => {
    const fetchImpl = okFetch({});
    expect(await resolveNfd(ADDR, { fetchImpl })).toBeNull();
  });
});
