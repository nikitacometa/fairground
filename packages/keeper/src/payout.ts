/**
 * Net payout for a resolved flip, recorded as the displayed payout on the proof card and in
 * the leaderboard P&L. This MUST mirror the coinflip contract's on-chain math:
 *
 *   net_payout = bet * 2 * (10000 - house_edge_bps) / 10000
 *
 * houseEdgeBps is fetched from the coinflip contract's `house_edge_bps` global state (v2+).
 * Callers pass a cached value; on fetch failure they fall back to 500n (5% edge) with a warning.
 * Keep this formula in sync with smart_contracts/coinflip/contract.py — a drift makes the
 * recorded/displayed payout disagree with what the chain actually paid.
 */

/** Net payout in microALGO for a resolved flip. A loss pays 0. */
export function computeNetPayout(
  won: boolean,
  amountMicroalgo: bigint,
  houseEdgeBps: bigint,
): bigint {
  if (!won) return 0n;
  return (amountMicroalgo * 2n * (10000n - houseEdgeBps)) / 10000n;
}
