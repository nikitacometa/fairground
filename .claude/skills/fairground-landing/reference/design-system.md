# Fairground Landing — Design System

Shared brand tokens with the game app (`../../fairground-frontend/reference/design-system.md`). This file adds the **landing-specific** layout, typography scale, and signature CSS patterns (adapted from the verdict-landing skill, re-skinned to dark amber).

## Aesthetic target

**Provably fair. Visibly serious.** "Precision instrument under dim light." Warm near-black, amber-gold accents, editorial structure, monospace for VRF data. A player arriving from a proof-card tweet must feel they hit a serious technical product — the trust signal IS the brand.

## OKLCH palette (60/30/10 weight rule)

```css
:root {
  /* 60% — backgrounds (warm near-black) */
  --bg-base: oklch(0.1 0.02 30);
  --bg-surface: oklch(0.14 0.02 30);
  --bg-elevated: oklch(0.18 0.02 30);
  --border: oklch(0.22 0.02 30);
  /* 30% — text */
  --text: oklch(0.96 0.01 80);
  --text-muted: oklch(0.65 0.02 60);
  /* 10% — accents */
  --primary: oklch(0.78 0.18 65); /* amber-gold — CTAs, headline accent */
  --win: oklch(0.72 0.18 145); /* win green */
  --loss: oklch(0.58 0.2 25); /* loss red */
  --vrf: oklch(0.7 0.12 240); /* VRF proof accent — sparingly */
}
```

Rule: amber is the only saturated hue used structurally. Green/red/blue appear only on win/loss/VRF semantics. Never tint neutral text with a colored background — use background shades.

## Typography

- **Display:** Space Grotesk (geometric, technical, distinctive). Headings > 2xl: `letter-spacing: -0.02em`.
- **Body:** Space Grotesk or system sans; line-height 1.5 body / 1.2 headings.
- **Mono:** JetBrains Mono — VRF rounds, beacon-output hashes, tx IDs ONLY (signals verifiability).
- Max 2 families per page (mono for code doesn't count). No Inter/Roboto/Open Sans.
- Fluid scale: `clamp()` for hero (`clamp(2.5rem, 6vw, 5rem)`), step down on an 8px grid.

## Spacing & layout

- 8px grid. Section padding 80–160px vertical.
- ≥ 30% of sections asymmetric (not center-stack). Left-aligned reads as designed.
- CSS grid / explicit flex for layout — never `margin: auto` as the layout mechanism.
- One level of card nesting max. No card-in-card.

## Signature CSS patterns (reuse verbatim, re-skin to amber)

- **Grain overlay** — subtle film grain on `--bg-base` (SVG `feTurbulence`, opacity ~0.03) for warmth.
- **Ember cursor trail** — amber hue 55–70 particles following the cursor (hero only). **Guard with `prefers-reduced-motion`.**
- **Scroll reveal (progressive enhancement)** — content visible by default; `IntersectionObserver` adds `.revealed` for an additive fade/translate. NEVER `opacity:0` without the observer (breaks bots/SSR/no-JS).
- **CTA glow** — amber box-shadow bloom on hover, `transform`/`opacity` only.
- **Code frame** — VRF explainer snippet in a macOS-traffic-light code block, JetBrains Mono.
- **Numeric counter** — live-stat counters animate up on reveal (treasury balance, total bets).

## Motion rules

- Easing `cubic-bezier(.22,1,.36,1)` (ease-out-quart). No `ease`/`linear`/`bounce`/`elastic`.
- Animate `transform` + `opacity` only. No `transition: all`.
- **`@media (prefers-reduced-motion: reduce)` is mandatory** — disable ember trail, scroll reveals, counters.

## Section framework

Hero (value prop in 5s + dual CTA) → VRF explainer (how provably-fair works, with the commit→reveal diagram) → Games (CoinFlip live, Minefield coming) → Proof-of-fairness live stats (treasury, total bets, last VRF round) → Leaderboard preview → FAQ → terminal easter egg (Konami → VRF explorer). Pull all numbers from the design bible; cite sources inline.
