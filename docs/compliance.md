# Compliance

This document is an operational reference, not legal advice. Fairground operates in a legal gray area common to crypto-native betting products. The framing strategy and geo-blocking requirements described here are minimum viable risk mitigation for a solo operator at sub-$1 max stake levels.

## House-Banked vs Parimutuel Risk

**House-banked (CoinFlip, Minefield):** The house holds float and pays out from its own balance. In most jurisdictions, this is gambling and requires a license to operate commercially. The mitigating factors at Fairground's v1 scale:

- Max stake: 0.5 ALGO (~$0.06 at current price). Below the enforcement interest threshold of every major regulator.
- Crypto-only: no fiat on-ramp, no payment processor integration, no chargeback surface.
- No advertising to general public: organic Twitter distribution and Algorand ecosystem newsletters only.
- Solo operator: most regulatory frameworks focus enforcement on commercial operators with significant user bases. A solo-founder product with sub-100 DAU and sub-$1 stakes is not a regulatory priority.

**Parimutuel (Oracle Games, Death Race):** Players bet against each other; the house takes rake from a pool. In most jurisdictions, this is treated more like a prediction market than a casino. The risk profile is lower than house-banked. However, it still constitutes betting on outcomes in most definitions.

**Verdict:** Do not seek legal clarity before launch. Spend the legal budget on geo-blocking implementation and a one-page TOS, not on opinion letters. At 0.5 ALGO max stake and crypto-only operation, enforcement risk is below the horizon. Revisit when revenue exceeds $50,000/month or when stakes exceed $10 equivalent.

## Jurisdictions to Geo-Block

These are hard blocks — no exceptions, no workarounds based on user assertions.

| Jurisdiction | Reason | Enforcement |
|---|---|---|
| **Thailand (TH)** | Gambling Act B.E. 2478, active enforcement. 220,000+ URLs blocked in 3.5 months. Nikita operates from Bangkok — direct personal legal exposure. | **NON-NEGOTIABLE.** Block Thai IPs before any code is deployed to production. |
| **United States (US)** | UIGEA 2006 covers online gambling with US users. CFTC jurisdiction over event contracts. Largest regulatory risk for any crypto operator. | Block before any public announcement or Foundation RT. |
| **United Kingdom (UK)** | UK Gambling Act 2005 + UKGC licensing requirement. Treasury's 2025 elevated ML risk assessment named crash games specifically. | Block before any public announcement. |
| **Indonesia (ID)** | Criminal Code prohibits online gambling. Government actively blocks gambling sites. Large Algorand user base creates enforcement surface. | Block before launch. |
| **India (IN)** | Information Technology Act 2000 + state-level gambling laws. Enforcement inconsistent but risk of payment processor issues. | Block before launch. |
| **Brazil (BR)** | Lei de Jogos (2023) requires licensing. Active enforcement since 2024. Large crypto user base creates exposure. | Block before launch. |

**Implementation preference:** Cloudflare Workers geo-block (CDN layer — cannot be bypassed by changing Accept-Language or spoofing headers as easily as IP middleware). Fallback: IP detection middleware in `packages/api` using `@maxmind/geoip2-node` with the free GeoLite2 database.

The Cloudflare approach blocks at the edge before any request reaches the server. Required for the proof-card CDN endpoint as well as the game dApp. A blocked user sees a 403 with a jurisdiction notice, not a blank page.

## Separate Entity / Brand Note

Fairground is a separate brand from Cometa. This separation provides:

1. **Regulatory distance**: Cometa's Farming-as-a-Service business and Algorand Foundation relationship are not contaminated by a gambling product under the same brand.
2. **Operational independence**: A regulatory action against Fairground does not affect Cometa's FaaS product or existing partner relationships.
3. **Audience segmentation**: Cometa's B2B (project creators, liquidity providers) and Fairground's B2C (degen players) are different audiences with different risk tolerances.

Do not cross-promote Fairground from Cometa's @CometaHub Twitter account until geo-blocking is confirmed operational. Do not mention Fairground in Cometa's Foundation grant applications or ecosystem newsletter appearances.

## 'No Foundation RT Before Compliance Scaffolding' Warning

Algorand Foundation amplification is the highest-leverage distribution event available. A Foundation RT of the CoinFlip proof card can drive hundreds of wallet interactions in hours. This is also the highest-risk moment for three reasons:

1. **Bankroll risk**: if the treasury is not adequately seeded (minimum 2,000 ALGO for CoinFlip, 5,000-10,000 ALGO for Minefield), a Foundation-driven traffic spike drains the pool and triggers the auto-pause. The "contract paused" screenshot becomes the Algorand gambling story, not the "provably fair" story.

2. **Geo-block risk**: Foundation amplification reaches users globally including in blocked jurisdictions. If geo-blocking is not in place, a user from Thailand or the US interacting with the contract creates regulatory exposure for Nikita personally.

3. **Framing risk**: the Foundation amplifies "VRF technology demonstrations" and "provably fair infrastructure." They do not amplify casino games. The framing in any communication requesting amplification must emphasize the VRF proof mechanism, the open-source contracts, and the xGov grant pathway — not the betting aspect. These two framings are not mutually exclusive but they are mutually dependent on ordering.

**Gate:** Do not request or accept Foundation amplification before:
- [ ] Geo-blocking operational (Cloudflare Workers or equivalent)
- [ ] Treasury seeded to minimum (2,000 ALGO for CoinFlip)
- [ ] TOS page live at `/tos`
- [ ] Contracts open-sourced on GitHub
- [ ] Proof card endpoint publicly accessible (for Twitter card previews)

## Framing Strategy

For Foundation communications, ecosystem newsletter mentions, and xGov grant applications:

**Use:** "Provably fair on-chain games powered by Algorand's native VRF randomness beacon. Every outcome committed to an Algorand block before any card is turned. Open-source contracts, shareable VRF proof cards, cross-game leaderboard on-chain."

**Avoid:** "Casino", "gambling", "house edge", "betting", "wager" in any Foundation-facing communication.

**xGov framing:** "VRF infrastructure demonstration with gamified proof of randomness. Open-source Puya contracts implementing commit-reveal VRF pattern. Measurable on-chain activity (10,000+ bets = 10,000+ VRF proof events on Algorand mainnet). retroactive xGov Medium tier (50,000-250,000 ALGO)." Astro Explorer received 200,000 ALGO for 1,000,000 gameplays over 3 years. Fairground's target is 10,000 bets before applying.

## TOS Minimum Requirements

- Crypto-only. No fiat accepted or implied.
- Age: user asserts they are 18+ (or applicable local minimum).
- Prohibited jurisdictions: listed explicitly (US, UK, TH, ID, IN, BR).
- VRF verification: link to Algorand Explorer verification instructions.
- No warranty of continued operation: solo operator, contracts may be paused or upgraded.
- Governing law: specify a neutral jurisdiction (e.g., Singapore or Cayman Islands).
