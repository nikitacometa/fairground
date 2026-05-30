# Compliance Ops Reference

Regulatory decisions and public framing rules. Read before any public announcement, grant application, or Foundation-facing content.

---

## Geo-Blocked Jurisdictions

Full spec in `ops/geo-blocking.md`. Summary:

| Code | Country | Non-negotiable? |
|------|---------|----------------|
| US | United States | Yes — CFTC/DOJ jurisdiction |
| UK | United Kingdom | Yes — Gambling Commission |
| TH | Thailand | **Yes — founder in Bangkok, active enforcement** |
| ID | Indonesia | Yes — active ISP-level blocking |
| IN | India | Yes — state-level enforcement risk |
| BR | Brazil | Yes — SECAP regulated since 2024 |

**Thai block is non-negotiable.** Thailand bans online gambling including crypto formats, with 220K+ URLs blocked in 3.5 months. Operating from Bangkok without TH blocking is personal legal exposure.

---

## Launch Gate

Geo-block must be **live and verified** before:
- Any public announcement on Twitter
- Ecosystem newsletter submission
- Foundation RT request
- xGov proposal submission
- Alpha Arcade or any Algorand Degen Discord mention

Verification: `ops/safety-state.md` geo-block counter must show `verified`.

---

## Foundation Framing Rule

**Never describe the platform as gambling in any content targeting Foundation channels.**

The Algorand Foundation amplifies open-source VRF tooling and provably-fair mechanics. It does not amplify casino games. The product is both of these things simultaneously — frame for the audience.

### For Foundation-facing content (grants, xGov, newsletter, RT requests)

Use: "provably-fair randomness infrastructure on Algorand — open-source contracts, verifiable on-chain VRF proof card for every outcome."

Avoid: casino, gambling, bet, wager, house edge, stake (in gambling context).

### For player-facing content (Twitter game threads, proof card share)

Direct language is fine: "Flip for 0.5 ALGO", "Prove your luck on-chain", "Every flip is a verifiable VRF proof."

Avoid: "Join our casino", "Beat the house", "Gamble with ALGO."

---

## xGov Path

A shipped open-source on-chain game with VRF proof infrastructure and 10K+ on-chain bets qualifies for retroactive xGov at Medium tier (50K-250K ALGO, ~$5,900-$29,500). Open-source the contracts from day one — this is both the compliance play and the xGov prerequisite.

Track milestone: 10K on-chain bets in `BOARD.md`.

---

## Licensing Horizon

At 0.5 ALGO max bets, sub-$1 stakes, crypto-only, no fiat on-ramp: enforcement interest is below the horizon for a solo operator. Track in BOARD.md:
- Curacao e-Gaming license: pursue at $50K+/month revenue (~$600K/year GGR)
- Malta MGA: pursue if expanding to EU user acquisition at scale
- US: blocked jurisdiction — do not pursue, do not plan around

---

## Parimutuel vs House-Banked

Parimutuel games (Algo Oracle Games, Memecoin Death Race): house holds zero outcome risk, only rake. Regulatory profile is cleaner in most jurisdictions. Build these after house-banked games are proven.

House-banked games (CometaFlip, Algo Minefield): house takes directional risk, but simpler mechanics and no liquidity dependency. Ship first because the math is tractable at 2,000 ALGO seed + 0.5 ALGO max bet.

No revenue share to token holders in any design — triggers SEC/CFTC security classification regardless of framing.
