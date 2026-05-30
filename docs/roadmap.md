# Roadmap

## Launch Sequence

### Days 1-14: CoinFlip

Ship CoinFlip first. Not because it is the best game — it is not. Algo Minefield has higher retention, better mechanics, and a stronger viral hook. CoinFlip ships first because:

1. No keeper bot as a hard dependency for the first user to play. The VRF result is verifiable in the same block group as the bet.
2. Proves the VRF proof card viral loop before committing 6-8 weeks to Minefield's more complex contract.
3. Seeds the house treasury that Minefield's bankroll requires (5,000-10,000 ALGO).
4. Tests wallet integration on real users before the harder game inherits it.
5. At 0.5 ALGO max bet and 2,000 ALGO seed, the variance math is solved before launch.

**What ships:** `HouseTreasury` contract, `CoinflipContract`, `LeaderboardContract` (stub), proof card PNG endpoint, Hono API, keeper bot (primary + standby), Next.js game dApp, geo-blocking.

**What does not ship in v1.0:** jackpot (add in v1.2 after measuring actual bets/day), ASA denomination (add in v1.1 after battle-testing the contract), mobile app (Pera deep-links handle mobile), token (threshold is 500 WAW, not achieved at launch).

**Bankroll math:** 2,000 ALGO seed, 0.5 ALGO max bet, 1.96x payout. Kelly solvency: the maximum theoretical run of consecutive wins that could drain the pool at these parameters exceeds 10,000 bets — the law of large numbers provides more protection than any individual variance event at this scale.

### Weeks 2-10: Algo Minefield

Minefield is the retention engine. CoinFlip's 6-8 week novelty window ends precisely when Minefield should be ready. The player who discovered Fairground through a coinflip proof card returns to find a richer product.

**Requirement before launch:** 5,000 ALGO in treasury (not 500, not 2,000 — the 20 ALGO max bet means three concurrent full-board clears require ~600 ALGO reserve). At ALGO = $0.118, that is ~$590. Achievable through CoinFlip house edge accumulation plus direct seed.

**What ships:** `MinefieldContract`, keeper session-expiry + jackpot trigger, proof card Minefield template, game canvas (5x5 grid, multiplier display, cashout button), progressive jackpot from day one.

**Keeper required for Minefield:** Unlike CoinFlip (atomic resolution in one app call), Minefield sessions span multiple reveals over minutes. Keeper handles session expiry (auto-refund after 48h inactivity) and jackpot distribution. Two-container deployment confirmed working from CoinFlip phase.

### Weeks 8-14: Algo Oracle Games

80% smart contract reuse from the existing `prediction-market` Puya repo. The main new piece: TWAP resolution keeper, which reuses the keeper pattern from Minefield. Differentiates from Alpha Arcade and Haystack by targeting Algorand DeFi events (TVL milestones, protocol launches, governance outcomes) that neither competitor serves.

The daily content cadence (3 markets/day on Twitter) converts the product into a content engine requiring zero advertising budget. Each market is a piece of content that invites engagement, debate, and bets simultaneously.

**Prerequisite:** CoinFlip confirmed 50+ daily players. This validates that the Algorand degen audience bets at all before committing 5-7 weeks to Oracle Games.

### Weeks 14-20: PackFight

Social acquisition mechanic. Shareable room link = every game is an acquisition event for up to 9 new wallets. Build after leaderboard and player base are established — the distribution benefit compounds on top of existing infrastructure.

The critical frontend investment: Pera deep-link mobile join-by-link UX. Only worth building once players exist to invite.

### Weeks 18-26: Memecoin Death Race

Ships last because the tribal hook (COOP vs BONEZ communities driving volume) is the entire distribution thesis. By the time this ships, Fairground has cross-game leaderboard identity, a house pool, and relationships with COOP and BONEZ from ASA denomination in CoinFlip v1.1.

**Prerequisite before writing contract code:** DM BonezAlgo — already in contact via Cometa — and ask: "If I put BONEZ in a race against COOP with 400 ALGO in the pot, will you post about it?" One yes is a distribution guarantee. Two yeses is a launch.

**Permissionless tick design:** No keeper on the critical race path. Pre-commit all 12 VRF beacon rounds at race start, let any wallet trigger each tick permissionlessly. Bettors themselves have economic incentive to advance the race (they want their winnings).

## Platform Thesis

Five games. One identity. One treasury. One proof card engine.

The five games are not five separate products. They are five entry points into one cross-game identity system built on Algorand's VRF. A player who discovered Fairground through a coinflip proof card arrives at Minefield to find their wallet already has a leaderboard rank and a bet history. The proof card from their best Minefield run is on their Twitter profile.

The shared infrastructure is what makes each subsequent game cheaper to ship:

| Component | Introduced at | Reused by |
|-----------|---------------|-----------|
| House pool treasury | CoinFlip | All games |
| Proof card PNG generator | CoinFlip | All games |
| Cross-game leaderboard | CoinFlip | All games |
| Wallet connect stack | CoinFlip | All games |
| Keeper bot pattern | Minefield | Oracle Games, PackFight, Death Race |
| VRF beacon integration | CoinFlip | All games |
| Vestige TWAP integration | Oracle Games | Death Race |
| Twitter proof card share intent | CoinFlip | All games |

## Anti-Overengineering Notes

Defer everything that requires knowing player count before you have players.

**No jackpot in CoinFlip v1.0.** The jackpot hook parameter is in the contract (rate = 0). At 50 bets/day, a 1% jackpot accumulates 0.25 ALGO per day — the jackpot fires every 2 months and pays out $0.03. Not a retention mechanic. Enable in v1.2 after measuring actual bets/day.

**No COMETA token until 500+ WAW.** A token launch before that threshold is a credibility risk. Burns require volume to be visible. At sub-$10K/month revenue, burn amounts are invisible.

**No crash/multiplier in CoinFlip v1.0.** One mechanic, prove it works, then extend. Crash is the highest-retention mechanic globally and the highest-regulatory-risk game in the set. Build it after CoinFlip confirms the audience exists.

**No ASA denomination in CoinFlip v1.0.** Launch ALGO-only, add $GONNA/$BONEZ in v1.1 after the contract is battle-tested on mainnet for two weeks. This is a parameter change, not a rewrite.

**No mobile-native app.** Pera and Defly deep-links handle mobile for all five games. A native app is a 3-month distraction and an App Store submission risk given the gambling content.

**No sSYN yield-bearing receipt token.** The legal surface is a security in every jurisdiction that matters. Operate the house pool without a receipt token until proper licensing is in place. The `HouseTreasury` contract is designed to support non-transferable LP positions as a future upgrade, not on day one.

**No Curacao license in v1.** At 0.5 ALGO max bets, sub-$1 stakes, crypto-only, no fiat on-ramp, the enforcement interest threshold is below the horizon for a solo operator. Invest in licensing at $50,000+/month revenue when it becomes the actual constraint.

**No BullMQ for keeper.** VRF resolution is not a retryable job. Each resolution is a unique on-chain event. BullMQ semantics (retry, delay, priority) are wrong for this use case. Use the tsx polling loop with idempotent `resolve()` contract calls.

## xGov Path

A shipped open-source on-chain game with VRF proof infrastructure and measurable user activity is a strong retroactive xGov proposal at Medium tier (50,000-250,000 ALGO, approximately $5,900-$29,500 at current price). Astro Explorer received 200,000 ALGO for 1,000,000 gameplays over 3 years. Cosmic Champs received 300,000 ALGO.

Open-source the contracts from day one. The xGov proposal writes itself from the GitHub repo and on-chain transaction history after 10,000+ bets. The application frames this as "VRF infrastructure demonstration" and "provably fair open-source gaming" — not gambling.
