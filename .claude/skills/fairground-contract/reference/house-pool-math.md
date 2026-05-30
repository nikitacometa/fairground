# House Pool Math Reference

## Treasury Parameters (CometaFlip v1)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Seed (minimum before launch) | 2,000 ALGO | Sub-2000 is below solvency floor |
| Seed (before Foundation RT) | 5,000-10,000 ALGO | Foundation amplification adds volume spike risk |
| Min bet | 500,000 microALGO (0.5 ALGO) | Fixed in v1 |
| Max bet | 500,000 microALGO (0.5 ALGO) | Fixed in v1; contract enforces 1% of live balance |
| House edge | 2% (200 bps) | Applied at resolve() time |
| Max payout BPS | 100 (1% of spendable balance) | Enforced at resolve() time, not flip() time |

## Payout Math

```
gross_payout    = bet * 2
net_payout      = gross_payout * (10000 - 200) / 10000
                = bet * 2 * 9800 / 10000
                = bet * 1.96

Example (0.5 ALGO bet):
  gross_payout  = 1,000,000 microALGO
  net_payout    = 980,000 microALGO (0.98 ALGO)
  house_keeps   = 20,000 microALGO per win
  house_keeps   = 500,000 microALGO per loss (entire bet)

Referral (0.25% of bet):
  referral_amount = bet * 25 / 10000 = 1,250 microALGO on 0.5 ALGO bet
  (deducted from house gross, not from player payout)
```

## Solvency Invariant

```python
# Enforced in HouseTreasury.pay_winner() at resolve() time:
spendable = app_account.balance - app_account.min_balance
max_payout = spendable * max_payout_bps / 10000  # default: 1%

# On 2000 ALGO treasury: max single payout = 20 ALGO
# On 0.5 ALGO max bet: max payout = 0.98 ALGO << 20 ALGO (safely under ceiling)

# At what balance does the ceiling become binding?
# net_payout <= 1% of balance
# 0.98 ALGO <= 0.01 * balance
# balance >= 98 ALGO  <-- below 98 ALGO, 0.5 ALGO bets are rejected
```

## Auto-Pause Threshold

Treasury drops below 2,000 ALGO -> keeper emits PAUSE event.
This is a soft threshold in the keeper, not enforced on-chain (max_payout_bps is the on-chain guard).

## Economic Simulation (CometaFlip v1)

At 100 flips/day with 0.5 ALGO average bet:
- Daily volume: 50 ALGO
- Expected house gross (2% edge): ~1 ALGO/day
- Time to double 2,000 ALGO treasury: ~2,000 days (without compounding bets > max)
- Risk of ruin from variance: negligible with 1% max payout cap

The 1% cap means: even at 100% win rate for players, the house loses at most 1% per flip.
At 2,000 ALGO and 0.5 ALGO max bets: max loss per game = 20 ALGO = 1% of treasury.
