# Compliance and Operations Reference

## Geo-Block (Required Before Any Public Announcement)

Blocked jurisdictions:

| Code | Country | Reason |
|------|---------|--------|
| US | United States | UIGEA, CFTC |
| GB | United Kingdom | UK Gambling Commission |
| TH | Thailand | Full ban, active enforcement (Bangkok = direct legal exposure) |
| ID | Indonesia | Law No. 7/1974 |
| IN | India | Public Gambling Act 1867 |
| BR | Brazil | Federal law 3,688/41 |

See `ops/geo-blocking.md` for full implementation spec.

**Thai block is non-negotiable.** Operating from Bangkok without blocking Thai IPs = direct
personal legal exposure. Must be live before:
- Any ecosystem newsletter mention
- Foundation RT request
- DM campaign to 5+ known Algorand community members

## Foundation Amplification Strategy

The Foundation amplifies open-source VRF tooling. It does not amplify casino games.

**In Foundation-facing content:**
- Frame as: "VRF technology demonstration that also pays out"
- Highlight: open-source contracts, ARC-56 client generation, proof card engine as public good
- Never mention: gambling, house edge, degen, casino in Foundation channels

**xGov retroactive eligibility:**
- Threshold: 10K+ on-chain bets, open-source contracts
- Category: Medium (50K-250K ALGO, ~$5,900-$29,500 at $0.12/ALGO)
- Open-source from day one (public GitHub nikitacometa/fairground)

## Licensing Strategy

| Revenue level | Action |
|--------------|--------|
| < $5K/month | No license needed. Sub-$1 stakes, no fiat on-ramp, crypto-only |
| $5K-$50K/month | Monitor. Consider Curacao pre-application |
| > $50K/month | Curacao license ($10K setup + $5K/year). Becomes actual constraint |

0.5 ALGO max bets at $0.15/ALGO = $0.075 max bet. Enforcement interest below threshold.

## Token Launch Guardrails

Do NOT launch a token until:
- 500+ weekly active wallets
- $50K+/month gross revenue
- COMETA/MINE token utility: proof card skins, leaderboard badge color, 1.5x jackpot draw weight
- NO revenue share to token holders (triggers SEC/CFTC security classification)

## Commit Message Discipline for Public Contracts

Never use: "gambling", "casino", "wager", "bet system" in commit messages.
Use: "VRF game", "fair game", "on-chain game", "proof-of-fairness".

This matters because the repo is public and Foundation grant reviewers read git history.
