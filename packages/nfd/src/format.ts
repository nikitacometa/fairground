import type { NfdRecord } from './types.js';

const ELLIPSIS = '…';

/**
 * Middle-truncate an Algorand address for display: `ABCDEF…WXYZ`.
 * Six leading chars (base32 has lower per-char entropy than hex) + four trailing.
 * Returns the address unchanged when it is already short enough.
 */
export function truncateAddress(address: string, head = 6, tail = 4): string {
  if (!address) return '';
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}${ELLIPSIS}${address.slice(-tail)}`;
}

/**
 * The human label for an address: the NFD name when resolved, otherwise the
 * truncated address. Never blank for a non-empty address.
 */
export function nfdLabel(record: NfdRecord | null | undefined, address: string): string {
  return record?.name ?? truncateAddress(address);
}
