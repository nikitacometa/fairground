---
name: fairground-landing
description: Build and polish the Fairground landing page (apps/landing, Astro 6 + Tailwind 4 + React 19 islands). Use when working in apps/landing/, deploying the landing, or designing any Fairground-branded marketing UI. Orchestrates i-frontend-design, i-audit, and i-polish with the Fairground dark-amber brand system and a ship-quality rubric. Ported from the prediction-market verdict-landing skill.
user-invokable: true
---

# Fairground Landing Skill

Orchestrates creation, refinement, and deployment of the **Fairground** landing page — the public face of "provably fair games on Algorand." The VRF proof card is the marketing budget; the landing must look like a serious technical product, not a generic degen casino.

**Live URL (target):** `https://fairground.xyz`
**Source tree:** `apps/landing/` (Astro 6.4.2 + Tailwind 4.3.0 + React 19 islands)
**Brand bible:** `docs/research/algorand-degen-games-2026-05.md` (positioning, survival thesis)
**Design system:** `reference/design-system.md` (dark-amber OKLCH, CSS patterns)

## When to invoke

- Any landing work: content, visuals, copy, sections, deploy
- "ship the landing" / "build the fairground landing"
- Working inside `apps/landing/`
- Any Fairground-branded marketing component (consistent brand system)

## Read these references before acting

| File                          | When to load                                                     |
| ----------------------------- | ---------------------------------------------------------------- |
| `reference/design-system.md`  | Any visual/style decision — palette, type, spacing, CSS patterns |
| `reference/antislop-rules.md` | Before writing any CSS/JSX — deterministic quality gate          |
| `reference/quality-rubric.md` | Self-review before declaring done                                |

Always read `design-system.md` + `antislop-rules.md` before writing any visual code. Also read `../fairground-frontend/reference/design-system.md` — the brand tokens are shared between the game app and the landing.

## Workflow (do not skip steps)

```
1. Understand
   → Read the brand thesis (docs/research/algorand-degen-games-2026-05.md — platform thesis + positioning)
   → Read reference/design-system.md (tokens + signature CSS patterns)

2. Design (before code)
   → Invoke i-frontend-design for design-thinking mode
   → Apply the locked taste dials from design-system.md
   → reference/antislop-rules.md is the deterministic gate

3. Implement
   → Astro 6 pages + components in apps/landing/src/
   → Tailwind 4 via @tailwindcss/vite (no PostCSS config)
   → React 19 islands only where interactive (client:load): LiveStats, ProofCardDemo
   → Content: pull exact numbers from the design bible; cite sources inline; no fabricated social proof

4. Self-review
   → Run i-audit against reference/quality-rubric.md; fix MAJOR/CRITICAL first
   → Re-read antislop-rules.md — any violation = FAIL

5. Polish
   → Invoke i-polish (final pass, never first)
   → 375px mobile check — no horizontal overflow, CTAs full-width
   → prefers-reduced-motion guard on EVERY animation

6. Build + deploy
   → pnpm --filter apps/landing build; eyeball dist/
   → Playwright MCP visual QA before deploy
   → rsync dist/ to hostinger:~/fairground/landing/ (verify nginx path first)
   → Verify: curl -sI https://fairground.xyz/
```

## Hardcoded taste dials (do not re-debate)

| Dial             | Value          | Rationale                                                                             |
| ---------------- | -------------- | ------------------------------------------------------------------------------------- |
| DESIGN_VARIANCE  | 7/10           | Asymmetric, memorable — not generic SaaS center-stack                                 |
| MOTION_INTENSITY | 5/10           | Purposeful: VRF round countdown, proof-card reveal, scroll reveals — never decorative |
| VISUAL_DENSITY   | 6/10           | Content-rich; the proof-of-fairness story needs density                               |
| STYLE VARIANT    | technical dark | Amber-gold on warm near-black. "Precision instrument under dim light."                |

## What to avoid (summary — full list in antislop-rules.md)

Purple-to-blue / cyan-on-dark gradients · neon glow · glassmorphism on content · Inter/Roboto/Open Sans · uniform icon-heading-text card grids · gradient text on stats · fabricated social proof · marketing cliches.

## Known landing bugs to fix on first pass (from the 2026-06-01 audit)

- `apps/landing/src/styles/global.css` is **never imported** → all OKLCH tokens are dead. Import it in `BaseLayout.astro`.
- Scroll-reveal is **broken**: `[data-reveal]{opacity:0}` with no `IntersectionObserver`. Content must be visible by default; add an observer that adds `.revealed` (additive animation only).
- **No `prefers-reduced-motion` guard** — wrap the ember cursor trail and add a blanket `@media(prefers-reduced-motion:reduce)` rule.
- **Dead AlgoExplorer link** in `index.astro` → use `allo.info` or `explorer.perawallet.app`.
- Missing SEO meta in `BaseLayout.astro`: canonical, `theme-color`, `og:site_name`, `twitter:site`.
- `LiveStats.tsx` / `ProofCardDemo.tsx` are orphaned (no page imports them); `ProofCardDemo` double-scales to 25%.

## Quality bar

Per `reference/quality-rubric.md` — weighted score **≥ 8.5/10** before shipping. Calibrate against Linear, Stripe, a16z — not against average Web3 landings. The bar: _would a skeptical Algorand dev believe the "provably fair" claim from the design alone?_

## Integration with other skills

- `i-frontend-design` — default creative mode; invoke first for any new section
- `i-audit` — diagnose (document only, don't fix during audit)
- `i-polish` — last step, never first
- `i-bolder` / `i-quieter` — weak/overdesigned sections
- `i-animate` — deliberate motion (coin flip, countdown, proof reveal)
- `unslop` — every line of English copy before it ships
- `generate-visual` — hero image, VRF explainer infographic, proof-card mockups
- `playwright` MCP — visual QA before deploy
