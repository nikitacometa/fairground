# Fairground Landing — Quality Rubric

Weighted 10-dimension self-review. Score each 0–10; weighted sum **≥ 8.5 to ship**.

**Calibration:** compare against Linear, Stripe, a16z, Rollbit's cleanest pages — NOT average Web3 landings. The unique bar: _does the design alone make a skeptical Algorand dev believe "provably fair"?_

| #   | Dimension              | Weight | Check                                                                                                          |
| --- | ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | Visual polish          | 15%    | 60/30/10 amber harmony, no AI-slop fingerprints (antislop-rules.md)                                            |
| 2   | Copy quality           | 15%    | Every stat sourced, benefit-focused headlines, no cliches, never the word "gambling" in Foundation-facing copy |
| 3   | Trust / fairness story | 12%    | The VRF commit→reveal explainer is legible to a non-expert in 15s; proof card is the hero artifact             |
| 4   | Hero impact            | 12%    | Value prop in 5s, dual CTA (Play / Verify), memorable hero (not stock)                                         |
| 5   | Typography             | 10%    | Space Grotesk + JetBrains Mono only, mono for VRF data, consistent scale                                       |
| 6   | Spacing & layout       | 10%    | 8px grid, 80–160px section padding, ≥ 30% asymmetric                                                           |
| 7   | Mobile                 | 8%     | 375px tested, no horizontal overflow, CTAs full-width, Pera deep-link works                                    |
| 8   | Technical              | 8%     | SEO meta complete (canonical, og, twitter, theme-color), semantic HTML, Lighthouse ≥ 90                        |
| 9   | Animation              | 5%     | Scroll reveals as progressive enhancement, reduced-motion guard, counters animate, no decorative motion        |
| 10  | Wow factor             | 5%     | One signature element worth screenshotting (live VRF round ticker, ember trail, proof-card demo)               |

## Thresholds

≥ 9.0 exceptional · 8.5–8.9 strong pass · 8.0–8.4 pass with 1–2 follow-ups · 7.0–7.9 fix MAJORs first · < 7.0 redesign.

## Self-review workflow

1. Scroll desktop top→bottom; score 1–4. 2. Resize 375px; score 6–7. 3. Build; check bundle/SEO; score 8. 4. Toggle `prefers-reduced-motion`; score 9. 5. Name your one shareable element; score 10. 6. Screenshot next to Linear/Stripe in the same viewport — which looks more designed? Score 1 honestly. 7. Pass → ship; fail → fix MAJORs, re-run.

## Anti-calibration traps

"It works" / "content is good" / "no bugs" / "I'm tired of polishing" are NOT passes. Beauty is a feature; the fairness story is a conversion driver.

## Escalation

Stuck at 7.0–8.4 after a polish pass → `i-critique` (design director) + `i-bolder` on the weakest sections before a second attempt. Don't repeat the same pass.
