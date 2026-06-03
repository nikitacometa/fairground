'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { resolveNfds } from './resolve.js';
import { nfdLabel } from './format.js';
import type { NfdRecord } from './types.js';

/** Coalesce concurrent useNfd() calls within this window into one batched lookup. */
const FLUSH_DELAY_MS = 60;

interface NfdStore {
  /** undefined = not yet resolved, null = resolved with no NFD, record = resolved name. */
  get(address: string): NfdRecord | null | undefined;
  request(address: string): void;
  version: number;
}

const NfdContext = createContext<NfdStore | null>(null);

/**
 * Session-scoped NFD resolver. Holds a Map cache keyed by address and coalesces
 * every useNfd()/WalletName request into batched /nfd/lookup calls (up to 20 per
 * request). Mount once near the wallet provider.
 */
export function NfdProvider({ children }: { children: ReactNode }): React.ReactElement {
  const cacheRef = useRef(new Map<string, NfdRecord | null>());
  const pendingRef = useRef(new Set<string>());
  const inflightRef = useRef(new Set<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);

  const flush = useCallback(() => {
    timerRef.current = null;
    const batch = [...pendingRef.current];
    pendingRef.current.clear();
    if (batch.length === 0) return;
    batch.forEach((a) => inflightRef.current.add(a));
    void resolveNfds(batch)
      .then((resolved) => {
        for (const addr of batch) {
          cacheRef.current.set(addr, resolved.get(addr) ?? null);
          inflightRef.current.delete(addr);
        }
        setVersion((v) => v + 1);
      })
      .catch(() => {
        // resolveNfds never throws, but guard anyway: cache null so we never loop.
        for (const addr of batch) {
          cacheRef.current.set(addr, null);
          inflightRef.current.delete(addr);
        }
        setVersion((v) => v + 1);
      });
  }, []);

  const request = useCallback(
    (address: string) => {
      if (!address) return;
      if (cacheRef.current.has(address) || inflightRef.current.has(address)) return;
      pendingRef.current.add(address);
      if (timerRef.current === null) timerRef.current = setTimeout(flush, FLUSH_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const store = useMemo<NfdStore>(
    () => ({ get: (address: string) => cacheRef.current.get(address), request, version }),
    [request, version],
  );

  return <NfdContext.Provider value={store}>{children}</NfdContext.Provider>;
}

export interface UseNfdResult {
  /** Resolved record, or null when there is no NFD / still pending. */
  record: NfdRecord | null;
  /** True while the first lookup for this address is in flight. */
  loading: boolean;
  /** The NFD name when resolved, else undefined. */
  name?: string;
  /** Display label: NFD name when resolved, otherwise the truncated address. */
  label: string;
  /** True when the label is a verified NFD name (not a raw address). */
  isNfd: boolean;
}

/**
 * Reverse-resolve a single address to its NFD, batched across all callers.
 * Renders the truncated address instantly and swaps in the name when resolved.
 * Outside an NfdProvider it degrades to a static truncated address.
 */
export function useNfd(address: string | null | undefined): UseNfdResult {
  const store = useContext(NfdContext);

  useEffect(() => {
    if (address && store) store.request(address);
  }, [address, store]);

  if (!address) {
    return { record: null, loading: false, label: '', isNfd: false };
  }

  const cached = store?.get(address); // undefined = pending, null = no NFD
  const record = cached ?? null;
  const loading = store ? cached === undefined : false;
  return {
    record,
    loading,
    name: record?.name,
    label: nfdLabel(record, address),
    isNfd: Boolean(record?.name),
  };
}

export interface WalletNameProps {
  address: string | null | undefined;
  className?: string;
  /** Wrap the label in `[ … ]` — the Fairground identity-container metaphor. */
  bracket?: boolean;
  /** Color for a resolved NFD name. Defaults to the amber primary CSS var. */
  nfdColor?: string;
  /** Color for a raw (un-named) truncated address. Defaults to the dim CSS var. */
  addrColor?: string;
  title?: string;
}

/**
 * Renders an address as its NFD name (amber) or a truncated address (dim).
 * Text-only by design — no avatars in the terminal aesthetic.
 */
export function WalletName({
  address,
  className,
  bracket = false,
  nfdColor = 'var(--color-primary)',
  addrColor = 'var(--color-text-dim)',
  title,
}: WalletNameProps): React.ReactElement {
  const { label, isNfd } = useNfd(address);
  const text = bracket ? `[ ${label} ]` : label;
  return (
    <span
      className={className}
      style={{ color: isNfd ? nfdColor : addrColor, fontFamily: 'var(--font-mono, monospace)' }}
      title={title ?? address ?? undefined}
    >
      {text}
    </span>
  );
}

export { truncateAddress, nfdLabel } from './format.js';
export type { NfdRecord } from './types.js';
