# Fairground — Skills Index

Project skills live in `.claude/skills/`. Global skills are in `~/.claude/skills/` and invoked via the `Skill` tool by name.

---

## Project Skills

### `fairground-contract`

**Path:** `.claude/skills/fairground-contract/SKILL.md`
**Invoke:** before writing any Puya contract code

Loads Algorand/AVM constraints, VRF integration patterns, house pool math, and compliance notes before you write a single line of Python. Prevents the class of contract bugs (missing MBR, wrong commit round, box reference exceeded) that are expensive to discover after deployment.

Workflow it enforces:
1. Load `reference/avm-constraints.md` — box MBR formula, group size 16, inner txn 256, box refs 8/call
2. Load `reference/vrf-integration.md` — beacon app 947957720 mainnet, commit N+8, refund backdoor
3. Load `reference/house-pool-math.md` — 2000 ALGO seed, 0.5 ALGO max bet, max_payout=1% live balance at resolve time
4. Load `reference/compliance-ops.md` — geo-block jurisdictions, Foundation framing rules
5. Run `puya-gotchas` check
6. Write contract, run tests, kill-the-mutant check, commit

**Reference files:**
- `reference/avm-constraints.md` — AVM opcode limits, box storage limits, group size
- `reference/vrf-integration.md` — beacon integration, commit-reveal pattern, refund backdoor
- `reference/house-pool-math.md` — solvency invariant, max payout formula, auto-pause logic
- `reference/compliance-ops.md` — geo-block list, Foundation grant framing, licensing threshold

---

### `fairground-frontend`

**Path:** `.claude/skills/fairground-frontend/SKILL.md`
**Invoke:** before writing any React or Astro component

Loads the Fairground design system (dark amber OKLCH palette), wallet integration patterns (@txnlab/use-wallet-react), proof-card share intent URL template, iOS relayer-wake hook, and mobile deep-link constants. Prevents the two most common frontend mistakes: raw algosdk in components, and wallet state managed with `useEffect`.

**Design system palette:**

| Token | Value | Use |
|-------|-------|-----|
| Background | `oklch(0.10 0.02 30)` | Page background |
| Primary (amber) | `oklch(0.78 0.18 65)` | CTAs, highlights |
| Win (green) | `oklch(0.72 0.18 145)` | Positive outcomes |
| Loss (red) | `oklch(0.58 0.20 25)` | Negative outcomes |
| VRF blue | `oklch(0.70 0.12 240)` | Proof card accents |

**Anti-patterns this skill prevents:**
- Raw algosdk in game components — all txn construction goes through `@fairground/sdk`
- `useEffect` for wallet state — use `useWallet()` hooks directly
- Purple-blue/cyan-on-dark/neon/glassmorphism — generic degen casino look, fails the AI Slop Test

**Reference files:**
- `reference/design-system.md` — full OKLCH palette, typography (Geist Variable + Fraunces Variable), spacing
- `reference/wallet-integration.md` — useWallet() patterns, iOS relayer-wake hook, deep-link constants
- `reference/proof-card-share.md` — Twitter intent URL template, share modal component pattern
- `reference/antislop-rules.md` — forbidden CSS/JSX patterns (glassmorphism, neon, center-stack)

---

### `smart-contract-audit`

**Path:** `.claude/skills/smart-contract-audit/SKILL.md`
**Source:** Ported from `~/dev/boost/Boost-Contracts/.claude/skills/smart-contract-audit/`
**Invoke:** `/smart-contract-audit` — before any contract deploy to testnet or mainnet, or when reviewing a contract for correctness

Multi-expert audit framework. Chain-agnostic methodology with Algorand/Puya-specific checks added in `puya-checks.md`. Runs: scope analysis, threat model, multi-expert rounds, severity-calibrated findings, triager validation, and report generation.

**Puya-specific additions (`puya-checks.md`):**
1. Solvency invariant — max payout enforced from live treasury balance at `resolve()` time, not bet time
2. Box storage limits — max 2500 bytes/box, 8 box references per txn, MBR pre-funding required
3. Inner txn limits — max 256 per group
4. VRF commit-reveal timing — minimum N+8 rounds, 48-hour refund backdoor mandatory
5. Idempotency key — `beaconRound + walletAddress + sessionNonce` prevents double-payout on retry
6. Referral wallet opt-in verification before inner transfer fires
7. Box deletion only after `claimed` flag is set — never before

**Cross-chain reference files retained:** `solidity-checks.md`, `anchor-checks.md`, `move-checks.md`, `ton-checks.md` — useful for pattern recognition from other ecosystems.

---

### `puya-gotchas`

**Path:** `.claude/skills/puya-gotchas/SKILL.md`
**Source:** Adapted from `~/dev/boost/boost-indexer-subgraph/.claude/skills/as-gotchas/SKILL.md`
**Invoke:** automatically by `fairground-contract`, or invoke directly when reviewing Puya code

Named pitfalls with before/after code patterns. Reference before writing any Puya contract.

**Pitfalls covered:**

1. **Box MBR pre-funding** — box access fails with `invalid box reference` if `2500 + 400*(key_len+val_len)` microALGO is not included in the transaction payment. CometaFlip player box requires 35,000 microALGO.

2. **Inner transactions are atomic and immediate** — no pending/deferred state; they fire within the same group.

3. **Never delete box before claimed flag** — once deleted, the player record is gone. Set `claimed = True`, THEN delete.

4. **Box size max 2500 bytes, 8 box refs per app call** — if you need more, redesign the storage layout.

5. **ARC-56 generated clients** — `packages/sdk/src/clients/` is auto-generated. Never edit by hand. Regenerate via `algokit generate client` after any contract change.

6. **Always use `simulate()` before `send()`** — on non-trivial production paths. Catches fee errors, budget overruns, and constraint violations without spending ALGO.

7. **GlobalMap/BoxMap require `algorand-python >= 3.0.0`** — pin exact version `algorand-python==3.5.0`. Do not use older patterns.

8. **Commit round minimum is N+8** — N+4 can arrive before the user's transaction confirms under congestion. On Algorand's 2.8s blocks, N+8 gives ~22 seconds. This is documented in the VRF beacon specification. Never reduce.

---

## Global Skills (invoke by name via Skill tool)

These live in `~/.claude/skills/` and are not duplicated in this repo.

### Design and Visual

| Skill | When to Use |
|-------|------------|
| `i-frontend-design` | **Invoke before writing the first component for any new page or section.** Locks aesthetic direction, provides AI Slop Test. Fairground passes the test if it avoids purple-blue/cyan-on-dark/neon/glassmorphism — the generic degen casino look. Mandatory for landing and game UI where design quality is a trust signal for "provably fair." |
| `generate-visual` | Generate promotional visuals: proof-card mockups, announcement images, social cards. Use for the hero image on the landing, VRF explainer infographic, and game result preview images. |
| `i-bolder` | Section feels weak or generic — apply after `i-frontend-design` to push contrast and distinctiveness. |
| `i-quieter` | Section is overdesigned or distracting — apply to reduce visual noise. |
| `i-animate` | Adding motion deliberately. Use for coin flip animation, VRF round countdown, proof card reveal. Never apply before `i-frontend-design`. |

### Writing and Content

| Skill | When to Use |
|-------|------------|
| `unslop` | Before any English copy goes into the landing or game UI. Removes AI-generated prose markers. |
| `humanizer-ru` | Before Russian content (Telegram announcements, strategy docs). |
| `i-distill` | Condense a research output or design brief into a tight reference doc. |

### Code Quality

| Skill | When to Use |
|-------|------------|
| `code-review` | After completing a feature or fix. Always run before opening a PR. |
| `review-my-code` | Quick pre-commit sanity check — staged/unstaged changes only. |
| `i-harden` | Before any production deploy: edge cases, error states, mobile viewports, `prefers-reduced-motion`. |
| `i-optimize` | Performance pass after correctness is confirmed. |
| `security-review` | Before mainnet contract deploy. Supplements `smart-contract-audit` for TS/API surface. |

### Operational

| Skill | When to Use |
|-------|------------|
| `verify` | After a code change: run the app and observe behavior in the real app, not just tests. |
| `commit-commands:commit` | Create a git commit following project conventions. |
| `commit-commands:commit-push-pr` | Commit, push, and open a PR in one flow. |
| `deep-research` | Algorand competitive analysis, regulatory landscape, grant opportunities. Fan-out web searches, verify claims, synthesize cited report. |
| `notify` | Send a formatted report to Telegram via @ClaudePantheon_Bot. |
| `run` | Launch the app and confirm a change works in the real running application. |

---

## Skill Routing Cheat Sheet

```
About to write a Puya contract?         → fairground-contract + puya-gotchas
Reviewing a contract for bugs?          → smart-contract-audit
About to write a React/Astro component? → fairground-frontend + i-frontend-design
Designing a new page section?           → i-frontend-design first, then implement
Writing landing copy?                   → unslop after drafting
Before committing?                      → review-my-code
Before mainnet deploy?                  → smart-contract-audit + security-review + verify
Need ALGO price data?                   → vestige MCP or WebFetch api.vestigelabs.org
Need to verify an API signature?        → context7 MCP
Need ecosystem research?                → deep-research (perplexity MCP)
Need visual QA before deploy?           → playwright MCP
```
