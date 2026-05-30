---
name: fairground-frontend
description: Load Fairground design system and wallet integration patterns before writing any React/Astro/Next.js code. Covers the OKLCH amber palette, use-wallet v4.6 patterns, proof card share-intent, iOS relayer-wake hook, mobile deep-links, and anti-patterns. Invoke before the first component in any new feature area.
user-invokable: true
---

# Fairground Frontend Skill

Load Fairground-specific design and wallet integration context before writing any frontend code in `apps/game/`, `apps/landing/`, or `packages/proof-card/`.

---

## When to invoke

- Before writing the first component in a new feature area
- Before making any design or styling decision (palette, typography, layout)
- Before integrating wallet connectivity or any `algosdk` usage
- Before building any proof card UI or share flow

---

## Read these references before acting

| File | When to load |
|------|-------------|
| `reference/design-system.md` | Any visual/style decision — palette, type, spacing, OKLCH tokens |

Always load `reference/design-system.md` before writing any CSS, Tailwind classes, or JSX that has visual impact.

For design thinking mode, invoke the global `i-frontend-design` skill first — it provides the design critique framework. Apply it against the Fairground design system from `reference/design-system.md`.

---

## Workflow

```
1. Load design system
   → Read reference/design-system.md
   → Note: amber-gold primary, dark background, NO purple/neon/glassmorphism

2. Design mode (for new sections or components)
   → Invoke i-frontend-design skill
   → Apply taste dials: DESIGN_VARIANCE 7/10, MOTION_INTENSITY 5/10

3. Wallet integration
   → All transaction groups constructed in @fairground/sdk, not in components
   → Use useWallet() from @txnlab/use-wallet-react, never import algosdk directly in components
   → Port useRelayerWake() hook for iOS Pera/Defly deep-link recovery (see design-system.md)

4. Implement
   → apps/game: Next.js 16 App Router — RSC for leaderboard, client components for game canvas + WS
   → apps/landing: Astro 6, React 19 islands for interactive elements only
   → Tailwind 4 utilities for 80% of styling; hand-written CSS in src/styles/ for OKLCH tokens

5. Proof card share flow
   → Use the canonical URL template from reference/design-system.md
   → Test that Twitter card preview renders: curl -A Twitterbot https://api.fairground.xyz/proof/{txnId}

6. Self-review (anti-pattern check)
   → No raw algosdk in any component file
   → No useEffect for wallet state (use use-wallet reactive hooks)
   → No purple/neon/glassmorphism UI
   → No Reach stdlib anywhere
   → Mobile: test at 375px, CTAs full-width, deep-link buttons present
```

---

## Critical Anti-Patterns

These are hard rules, not preferences:

1. **No raw `algosdk` in component files.** All transaction construction lives in `@fairground/sdk`. Components call SDK methods, never `algosdk.makePaymentTxnWithSuggestedParamsFromObject()` directly.

2. **No `useEffect` for wallet state.** The `@txnlab/use-wallet-react` hooks are reactive — use `useWallet()` directly. `useEffect` on wallet state causes race conditions on mobile reconnect.

3. **No purple, cyan, or neon.** The generic degen casino look is the opposite of the trust signal Fairground needs. Amber-gold on dark background. See design-system.md for the exact OKLCH values.

4. **No Reach stdlib.** The original Cometa contracts used Reach. Fairground uses Puya. There is no Reach dependency anywhere in this repo.

5. **No `as any` in component files.** Use proper types from `@fairground/types`. If a type is missing, add it to the `types` package.
