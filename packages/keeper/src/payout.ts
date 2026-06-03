/**
 * Net payout for a resolved flip, recorded as the displayed payout on the proof card and in
 * the leaderboard P&L. This MUST mirror the coinflip contract's on-chain math:
 *
 *   net_payout = bet * 2 * (10000 - HOUSE_EDGE_BPS) / 10000
 *
 * With HOUSE_EDGE_BPS = 300 (3% edge) that is bet * 2 * 9700 / 10000 = 1.94x.
 * Keep these constants in sync with smart_contracts/coinflip/contract.py — a drift here makes
 * the recorded/displayed payout disagree with what the chain actually paid.
 */
export const HOUSE_PAYOUT_NUMERATOR = 9700n; // 10000 - HOUSE_EDGE_BPS(300)
export const HOUSE_PAYOUT_DENOMINATOR = 10000n;

/** Net payout in microALGO for a resolved flip. A loss pays 0. */
export function computeNetPayout(won: boolean, amountMicroalgo: bigint): bigint {
  if (!won) return 0n;
  return (amountMicroalgo * 2n * HOUSE_PAYOUT_NUMERATOR) / HOUSE_PAYOUT_DENOMINATOR;
}
