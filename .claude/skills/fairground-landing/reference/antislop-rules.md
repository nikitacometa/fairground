# Fairground Landing — Antislop Rules (deterministic gate)

Any violation = automatic FAIL during self-review. Adapted from the verdict-landing rules, re-tuned for Fairground's **dark-amber, technical** brand (note: Fairground is dark-themed, unlike Verdict's light editorial theme).

## Color

1. **No pure `#000` / `#fff`.** Tint toward the warm hue. Use `oklch()`, not raw hex.
2. **No purple-to-blue or cyan-on-dark gradients.** The #1 generic-degen-casino fingerprint — it destroys the "provably fair / serious" signal.
3. **No neon glow on everything.** One restrained amber CTA glow is the ceiling.
4. **Amber is the only structural accent.** Green/red/blue appear only on win/loss/VRF semantics. Max 4 hues beyond neutrals.
5. **No gray text on colored fills.** Use background shades / transparency.

## Typography

6. **No Inter, Roboto, Open Sans, Lato, Montserrat, Poppins.** Space Grotesk (display/body) + JetBrains Mono (code/VRF data) only.
7. **Mono only for real data** — VRF rounds, beacon hashes, tx IDs. Not as a generic "tech vibe."
8. **Max 2 families per page.** No gradient text on stats/headings (logotype once, never on numbers).

## Layout

9. **No card-in-card.** One card level max.
10. **No uniform icon-heading-text grids.** Vary ≥ 40% of cards by size/layout.
11. **No center-everything.** ≥ 30% of sections asymmetric/left-aligned.
12. **No giant rounded icons above every heading.** Small inline SVG marks instead.
13. **CSS grid / explicit flex for layout** — not `margin: auto`.
14. **No glassmorphism on content.** Glass only on the sticky nav (max 1 instance).

## Motion

15. Easing `cubic-bezier(.22,1,.36,1)`. No `ease`/`linear`/`bounce`/`elastic`.
16. No `transition: all`. Animate `transform` + `opacity` only.
17. **`prefers-reduced-motion: reduce` is mandatory** — ember trail, scroll reveals, counters all gated.
18. **Scroll-reveal must be progressive enhancement** — content visible by default; `IntersectionObserver` adds the class. Never ship `opacity:0` without the observer.

## Content / copy

19. **No fabricated social proof** — no fake user counts, testimonials, ratings. "Provably fair / N on-chain bets" with a real source is OK.
20. **Every stat cites a source** inline (treasury balance from chain, total bets from the API). No unsourced numbers.
21. **No marketing cliches:** "revolutionary", "game-changing", "next-generation", "seamless", "empower", "unleash", "to the moon".
22. **Never describe the product as gambling** in any copy that could reach Algorand Foundation channels — framing is "VRF tech demonstration that also pays out" (see CLAUDE.md compliance).
23. Active voice, present tense.

## Assets

24. **No stock photos or generic 3D gradient blobs.** Custom SVG / hand-composed gradients only. The VRF proof card is the signature visual.

## Red-team before shipping

- [ ] _"If someone said 'AI made this,' would they believe it instantly?"_ → redesign if yes
- [ ] Can a reader cite a source for every number on the page?
- [ ] Does ≥ 1 section break the central grid on purpose?
- [ ] Every interactive element in all 8 states (default/hover/focus/active/disabled/loading/error/success)?
- [ ] Lighthouse accessibility ≥ 95, reduced-motion respected?
- [ ] Does the design alone make the "provably fair" claim believable?
