# Tokenomics

Phase 1 (launch through 500 weekly active wallets): zero token. Honest house-edge economics. Every dollar from the house edge is structurally cleaner than any token at sub-500-WAW scale.

## House Edge Model

**CoinFlip:**
- House edge: 2%
- Win payout: 1.96x (player bets 1 ALGO, wins 1.96 ALGO)
- Rake distribution per bet (1 ALGO example):
  - Jackpot accumulator: 1% = 0.01 ALGO
  - Referral (if set): 0.5% = 0.005 ALGO
  - Net to house treasury: 0.5% = 0.005 ALGO (after jackpot + referral)
  - Effective player-side edge: 2%

**Algo Minefield (v2):**
- House edge: 2% embedded in multiplier table
- Rake distribution per session:
  - Jackpot accumulator: 1%
  - Leaderboard prize pool: 0.5%
  - Referral (if set): 0.5%
  - Net to operator: 0.5%

**Multiplier table (Minefield, bomb count N, cells revealed K):**

Multiplier at step K with N bombs:
```
m(K, N) = (25 - N)! / (25 - N - K)! / (25! / (25 - K)!) * (1 / 0.98)
```

This is the actuarially fair multiplier for K consecutive safe reveals with N bombs on a 25-cell board, reduced by 2% for house edge. The 0.98 divisor is the only place the house takes its cut — the multiplier table is otherwise honest probability.

## Treasury

The `HouseTreasury` Puya contract holds the house pool as a native ALGO balance. No receipt tokens. No transferable positions. No secondary market.

**Seeding schedule:**
- CoinFlip launch: minimum 2,000 ALGO. At 0.5 ALGO max bet, the Kelly criterion solvency floor is satisfied.
- Minefield launch: minimum 5,000 ALGO (recommended 10,000 ALGO). At 20 ALGO max bet, three concurrent full-board clears at maximum payouts require ~600 ALGO reserve to remain solvent — 5,000 ALGO provides a 8x buffer.

**Solvency invariant (enforced in contract):**

At every `resolve()` call, the contract reads the live treasury balance and enforces:
```
payout_amount <= treasury_live_balance * max_payout_bps / 10000
```

`max_payout_bps` defaults to 100 (= 1%). If the treasury drops to 2,000 ALGO, the max single payout is 20 ALGO, regardless of what was committed at bet time. A player who bet into a 5,000 ALGO treasury and resolves into a 2,000 ALGO treasury gets a smaller payout than expected — this is by design. The alternative (paying out at bet-time-committed amounts) is insolvency.

**Auto-pause:** If live balance drops below `TREASURY_MIN_BALANCE_MICROALGO` (default 2,000 ALGO), keeper emits a `PAUSE` event. The contract's `emergency_pause` flag prevents new bets. Existing unresolved bets are refunded via the 48h backdoor.

## Jackpot Accrual

1% of every bet accumulates in a dedicated jackpot box in the game contract. The jackpot box stores the current balance as a `uint64` microALGO value.

**Trigger condition (CoinFlip v1.2+):** `VRF_output mod 500 == 0`. At uniform VRF distribution, this fires roughly every 500 bets. At 200 bets/day, jackpot fires every ~2.5 days. At 2,000 bets/day, roughly every 6 hours.

**Jackpot size at trigger:**
- 200 bets/day × 0.5 ALGO avg bet × 1% × 2.5 days = 2.5 ALGO (~$0.30 at current price)
- 2,000 bets/day × 2 ALGO avg bet × 1% × 0.25 days = 5 ALGO

Small in USD at current ALGO price. Large as an on-chain event. The jackpot balance displays on the frontend in real time — it is a persistent content hook that grows every day and writes itself as a weekly tweet.

**Not in CoinFlip v1.0.** The jackpot hook parameter is present in the contract (rate can be zero). Enable in v1.2 after actual bets/day is measured. A jackpot that fires once a year at low volume is not a retention mechanic.

**Minefield jackpot (v2):** Full-board clear at 5+ bombs grants automatic jackpot eligibility regardless of `VRF mod 500`. Jackpot eligibility is the highest-possible achievement the platform produces — the rarest achievable outcome combined with the largest payout is precisely the content event that earns a thread, not just a tweet.

## Referral Rake-Share

On-chain referral parameter in every game contract. Any wallet address can be passed as the `referrer` argument in `flip()` or `start_game()`. If non-zero:

- Referrer receives 0.5% of the bet amount as an inner ALGO transfer at resolve time.
- The contract verifies the referrer wallet has an ALGO account (opted in) before firing the transfer. If the referrer is invalid, the rake goes to the house treasury instead.
- The referral parameter is stored in the session box and recorded in Postgres (`bets.referrer_wallet`).

**Distribution mechanism:** Every ecosystem participant with any Algorand audience becomes an incentivized distributor. The on-chain attribution is permanent and verifiable. At 0.5% rake, a referrer who drives 1,000 ALGO in bets earns 5 ALGO — roughly $0.59 at current price. At $5/ALGO, that is $25. Not life-changing at v1 volume, but structurally correct from day one.

**Frontend:** `app.fairground.xyz/?ref={walletAddress}`. The `ref` param is read on page load and passed to every `flip()` call during that session. Stored in sessionStorage, not localStorage — clears when tab closes.

## House-as-a-Vault (Future Option)

The `HouseTreasury` architecture enables a future LP model without requiring a redesign. The path, when/if it becomes relevant:

1. Define a non-transferable LP position token (non-tradeable ASA, clawback = contract address). Non-transferable specifically avoids the Howey-test revenue-sharing security classification.
2. LP providers deposit ALGO, receive a position token reflecting their pool share.
3. Position tokens are redeemable at any time for the pro-rata ALGO balance.
4. The house edge grows the pool, increasing each position's redemption value over time.

**Do not build this until:** (a) proper licensing is in place (Curacao minimum), (b) a legal opinion confirms the non-transferable structure does not trigger securities law in the operating jurisdiction, and (c) the pool exceeds $20,000 — below that threshold, LP yield is meaningless (a 2% edge on $20K over 30 days generates $400 to split among all LPs).

The correct v1 structure is a solo-operated house pool seeded by Nikita. No LP tokens, no receipt tokens, no secondary market.

## Token (Phase 2 — threshold-gated)

Do not launch a token before 500+ weekly active wallets. A token launch before that threshold is indistinguishable from a rug regardless of intent. The burn mechanic requires volume to be visible.

**When the threshold is met:**
- Fixed supply: 10,000,000 COMETA ASA. Zero emission post-launch.
- Distribution: founders (Nikita), liquidity pool on Tinyman, community (airdrop to top 1,000 bettors by volume at snapshot).
- Buy-and-burn: 20% of weekly house gross buys COMETA from Tinyman open market, burns 90%, distributes 10% to a locked staker pool.
- Utility only: proof card skin variants, leaderboard badge color, 1.5x jackpot draw weight.
- No revenue share, no staking yield in any transferable token, no emissions.

**The burn is the only on-chain mechanic.** Supply only decreases. Burns happen even on weeks where gross revenue is below the burn threshold — any week with at least one bet generates some burn. This is the Rollbit model: structurally deflationary regardless of profitability.

**Never design around META price.** This is a fresh game token. META price is irrelevant to Fairground mechanics.

## Revenue Projections (for bankroll planning, not promises)

| Phase | Bets/day | Avg bet (ALGO) | Daily vol (ALGO) | House edge | Gross daily rev |
|-------|----------|----------------|-----------------|------------|------------------|
| Early (week 1-4) | 50 | 0.5 | 25 | 2% | 0.5 ALGO (~$0.06) |
| Growing (month 2-3) | 500 | 1 | 500 | 2% | 10 ALGO (~$1.18) |
| Established (post-Minefield) | 2,000 | 2 | 4,000 | 2% | 80 ALGO (~$9.44) |
| At token threshold (500 WAW) | 5,000 | 3 | 15,000 | 2% | 300 ALGO (~$35.40) |

At ALGO = $0.118 (May 30, 2026 price). Revenue in USD is more sensitive to ALGO price than to bet volume at this scale. The xGov grant (50,000-250,000 ALGO retroactive, available after 10,000 on-chain bets) is a larger near-term revenue event than house edge at early volume.
