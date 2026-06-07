# Proof-Card Evaluation Rubric

The proof card is the marketing budget. It lives or dies in an X/Twitter feed at thumbnail size,
scrolled past in 3 seconds. This rubric scores a rendered card so iterations are judged against a
fixed bar, not vibes. Each dimension is 0–10; weighted total out of 100.

Render a card (`pnpm --filter @fairground/proof-card exec tsx src/cli.ts --sample > card.png`, or a
real `/proof/:txn` PNG) and score against every row. A card ships when the weighted total ≥ 82 AND
no single dimension < 6.

| #   | Dimension                    | Weight | What a 10 looks like                                                                                                                                                      |
| --- | ---------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **3-second readability**     |     15 | At thumbnail size you instantly read: won/lost, how much, "provably fair". The hero number dominates; nothing competes with it.                                           |
| 2   | **Hero impact / juice**      |     15 | The win lands emotionally — huge number, real glow, amber/green luminance. It feels like a _prize_, not a receipt line.                                                   |
| 3   | **Brand identity**           |     12 | Unmistakably Fairground in one glance: ASCII coin, amber-on-near-black, IBM Plex Mono, minted-certificate frame. Could never be mistaken for a generic casino card.       |
| 4   | **Win/Loss differentiation** |     10 | A win and a loss are radically different _in brightness and composition_, not just text color. A muted thumbnail still tells them apart.                                  |
| 5   | **Trust signals**            |     12 | VRF round, beacon output, txn id, derivation formula read as credible cryptographic proof — the beacon output (the key datum) is visually elevated above the boilerplate. |
| 6   | **QR scannability**          |      8 | The QR is large enough to scan from a phone viewing the tweet preview (≥ 190px on a 1600px card; high contrast; quiet margin).                                            |
| 7   | **Composition & balance**    |     10 | No dead zones, no cramping. Clear hero/proof split, deliberate negative space, aligned grid. Depth via background texture + corner glow.                                  |
| 8   | **Share-worthiness**         |      8 | A player _wants_ to post this. It has a "wait, that's clean" beat — screenshot bait.                                                                                      |
| 9   | **Legibility & correctness** |      6 | Every string fully visible, nothing clipped/overlapping; no garbled glyphs; hashes truncated sensibly.                                                                    |
| 10  | **Atmosphere / depth**       |      4 | Not flat. Background guilloché, corner phosphor, seal relief and subtle shadows give the card a lit, premium surface.                                                     |

## Known weaknesses of the v2 card (baseline to beat)

1. QR 132px → ~41px in a mobile tweet preview — not scannable. _(dim 6)_
2. Seal watermark at `opacity 0.1` over near-black — effectively invisible. _(dim 10)_
3. Loss card is sparse: "FAIR." in a 600px column, big empty gap vs. the win's 92px hero. _(dims 1,4)_
4. Win/loss washes (`rgba(x,0.12)`) are so subtle a muted thumbnail reads identically. _(dim 4)_
5. No glow/luminosity — the card is flat. _(dims 2,10)_
6. Proof rows are uniform — beacon output (the key datum) looks like the boilerplate. _(dim 5)_
7. Brand URL in `textMuted (#5a3a20)` is invisible against the bg — the most important persistent
   marker disappears. _(dim 3)_
8. Dividers `#2e1a0e` on `#110c08` — structural separation nearly invisible. _(dim 7)_

## Scoring procedure (for iteration judging)

Independent judges view ONLY the rendered PNG (no code), score each dimension with one-line
justification, and flag the single highest-ROI fix. Median across judges per dimension; the next
iteration must lift the lowest-scoring dimensions without regressing any that already pass.
