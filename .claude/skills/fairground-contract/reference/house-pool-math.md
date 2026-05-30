# House Pool Math Reference

Economics of the Fairground house treasury. These numbers are design decisions, not suggestions — enforce them in contracts.

---

## CometaFlip v1 Parameters

| Parameter | Value | Enforcement point |
|-----------|-------|------------------|
| House seed (minimum to launch) | 2,000 ALGO | Verified by operator before deployment |
| Min bet | 0.5 ALGO (500,000 microALGO) | `assert payment.amount >= MIN_BET + BOX_MBR` in `flip()` |
| Max bet | 0.5 ALGO (500,000 microALGO) | Same assertion. v1 min=max for simplicity |
| House edge | 2% | Built into the win probability: 49% player win (coinflip with 2% edge) |
| Max payout per resolve | 1% of live treasury balance | Enforced at `resolve()` time via `house_treasury.get_available_balance()` |
| Auto-pause threshold | 2,000 ALGO | `house_treasury` sets `emergency_pause = True` when balance < threshold |
| Referral rake | 0.5% of house edge (optional) | Applied only when a `referrer` param is passed and the wallet is opted-in |

---

## Max Payout Enforcement

**The 1% cap is enforced at resolve time, not at bet time.** Treasury balance changes between bet and resolve (other players win, operator adds/removes funds). The contract must read the live balance at resolve.

```python
@arc4.abimethod
def resolve(self, player: arc4.Address, beacon_round: UInt64) -> None:
    # ... load bet, verify beacon round, derive outcome ...
    
    if player_wins:
        # Gross payout = bet_amount (return stake) + bet_amount * (10000 / edge_bps - 1)
        # For 2% edge: payout = bet_amount * 2 * 0.98 = 1.96 * bet_amount
        # Simplified v1: payout = bet_amount * 2 - house_fee
        gross_payout = bet_data.bet_amount * UInt64(2)
        
        # Enforce 1% of live treasury
        live_balance, _txn = arc4.abi_call(
            HouseTreasury.get_available_balance,
            app_id=Application(HOUSE_TREASURY_APP_ID),
            fee=0,
        )
        max_payout = live_balance.native // UInt64(100)  # 1%
        
        actual_payout = gross_payout if gross_payout <= max_payout else max_payout
        
        itxn.Payment(
            receiver=player.native,
            amount=actual_payout,
            fee=0,
        ).submit()
```

---

## Solvency Invariant

At any point in time, `house_treasury.get_available_balance()` must be >= 2,000 ALGO for CometaFlip to accept new bets.

The invariant: with a 2% edge and 0.5 ALGO max bet capped at 1% of balance, the house can sustain a continuous losing streak of ~70 consecutive maximum bets before hitting the auto-pause threshold. This is astronomically unlikely but bounded.

```
P(70 consecutive max losses at 49% win rate) = 0.49^70 ≈ 10^-21
Expected bets before ruin from 2000 ALGO seed: effectively never within a normal operational window
```

Sub-2,000 ALGO is below the solvency floor. Do not launch CometaFlip below this seed.

---

## Phase 2 House Pool Requirements

| Game | Minimum treasury before launch |
|------|-------------------------------|
| CometaFlip | 2,000 ALGO |
| Algo Minefield | 5,000–10,000 ALGO |
| Algo Oracle Games (parimutuel) | None (house holds zero race risk, rake only) |
| PackFight (pvp) | Established player base required |
| Memecoin Death Race (parimutuel) | ASA partner confirmation required |

---

## Referral System (v1)

```python
REFERRAL_BPS: Final[UInt64] = UInt64(10)  # 0.1% of bet amount to referrer

@arc4.abimethod
def flip(
    self,
    payment: gtxn.PaymentTransaction,
    target_round: UInt64,
    referrer: arc4.Address,  # Optional: pass zero address to skip
) -> None:
    ...
    if referrer.native != Global.zero_address:
        # Verify referrer is opted in to the app before sending
        # (or use a try/send pattern that does not fail on missing opt-in)
        referral_amount = bet_amount * REFERRAL_BPS // UInt64(10_000)
        # Store referral for payout at resolve time — don't send at bet time
        # (referral is only due if house wins, which is determined at resolve)
```

Referral accounting: store the referrer address and amount in the bet box. At `resolve()`, if the house wins, send the referral amount from the house rake to the referrer wallet (after verifying opt-in).

---

## Tokenomics (Phase 2 only — not in v1)

No token until 500+ weekly active wallets and $50K+/month revenue. When it launches:
- 20% of weekly gross buys-and-burns from Tinyman
- Token utility: proof card skin variants, leaderboard badge color, 1.5x jackpot draw weight
- No revenue share to token holders — triggers SEC/CFTC security classification
