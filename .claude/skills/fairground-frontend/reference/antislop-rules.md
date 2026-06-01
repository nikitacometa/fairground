# Fairground Frontend Antislop Rules

The deterministic quality gate for the **game dApp** (`apps/game`). For the landing page use `../../fairground-landing/reference/antislop-rules.md` (same brand, marketing-page-specific additions). Any violation = FAIL during self-review.

The stakes: a player arriving from a VRF proof-card tweet must feel they hit a serious, verifiable product. Generic-casino visual defaults read as "scam" and undo the provably-fair trust signal.

## Visual

1. **No purple-to-blue / cyan-on-dark gradients, no neon glow.** The generic degen-casino fingerprint. One restrained amber CTA glow is the ceiling.
2. **No glassmorphism on game UI.** Trust = clarity, not blur. (Sticky nav only, max 1 instance.)
3. **Amber-gold is the only structural accent.** `--win` green / `--loss` red / `--vrf` blue appear only on those exact semantics.
4. **No pure `#000`/`#fff`** — tint toward the warm hue; `oklch()` not raw hex.
5. **No gradient text on numbers** (bet amounts, multipliers, balances) — reduces readability, reads as AI slop.

## Typography

6. **Space Grotesk** (UI) + **JetBrains Mono** (VRF rounds, beacon hashes, addresses, tx IDs) only. No Inter/Roboto/Open Sans.
7. Mono only for real data, never as a generic "tech" vibe.

## Code hygiene (frontend-specific)

8. **No raw `algosdk` in components** — all txn construction in `@fairground/sdk` generated clients.
9. **No `useEffect` for `useWallet()` state** — it's reactive; an effect re-introduces the mobile-reconnect race.
10. **No `Buffer` / Node globals in browser code** — use `Uint8Array` / `TextEncoder`. (`CoinflipGame.tsx:184` violates this.)
11. **No `as any` / `as never`** — use types from `@fairground/types`; bigint for all microALGO/round/appId values, never `Number`.
12. **No `@reach/stdlib` or any Reach pattern** — Puya only.

## Motion

13. Easing `cubic-bezier(.22,1,.36,1)`; animate `transform`+`opacity` only; no `transition: all`.
14. **`prefers-reduced-motion: reduce` mandatory** — the coin-flip animation and VRF countdown must degrade to instant state changes.

## Correctness (these are real scaffold bugs — don't reproduce)

15. **Send the player's pick to the server** and compare it to the contract outcome — don't hardcode the result string.
16. **`BOX_MBR = 49_700n`** (matches the contract), not `36_900n` — the payment must cover it or every flip reverts.
17. **Maintained explorer links only** (`allo.info` / `explorer.perawallet.app`), never `algoexplorer.io`.

## Red-team before shipping

- [ ] Would someone say "AI casino template" at a glance? → redesign.
- [ ] Every interactive element in all 8 states (default/hover/focus/active/disabled/loading/error/success)?
- [ ] Is the VRF round / proof visible and legible during and after a flip (the trust signal)?
- [ ] Lighthouse a11y ≥ 95; reduced-motion respected; 375px no overflow.
