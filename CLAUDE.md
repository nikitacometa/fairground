@AGENTS.md

# Claude Code specifics — Fairground

## Project identity & positioning (for copy/marketing tasks)

Positioning: "Provably fair games on Algorand." The VRF proof card (round, beacon output hash, txn ID)
is the marketing asset — survivor comps are SatoshiDice, Bustabit, Rollbit. Full narrative, validation
matrix and tokenomics playbook: `docs/research/algorand-degen-games-2026-05.md` — written pre-launch,
treat its specific numbers as historical rationale; `docs/tokenomics.md` and `docs/roadmap.md` are the
current specs (and are themselves known-stale in places, see `AGENTS.md` → Stale facts).

## MCP servers (`.mcp.json`)

| Server                                                                       | Purpose                                                                               | When                                                                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `algorand` (`@goplausible/algorand-mcp@4.2.5`)                               | beacon inspection, contract state reads, `simulate_transactions` before mainnet spend | always; defaults to `ALGORAND_NETWORK=localnet`, switch to mainnet only for explicit inspection tasks          |
| `playwright` (`@playwright/mcp`)                                             | visual QA of the game dApp before deploy, competitor scraping                         | before any production deploy                                                                                   |
| `vestige` (npm package is `vestige-mcp`, **not** `@goplausible/vestige-mcp`) | ALGO/USD price for jackpot/treasury display                                           | if it fails to load, fall back to WebFetch against `api.vestigelabs.org`                                       |
| `context7`, `perplexity`                                                     | inherited from global `~/.claude/mcp.json` — do not duplicate in `.mcp.json`          | `context7` before calling a versioned library API; `perplexity` for multi-source ecosystem/regulatory research |

## Skills

Index: `SKILLS.md`. Triggers: writing Puya contract code → `fairground-contract` (its
`reference/vrf-integration.md` and `reference/house-pool-math.md` are stale — see `AGENTS.md` →
Stale facts — verify their numbers against `contract.py`/`deploy_config.py` before using them);
frontend work → `fairground-frontend`; landing page → `fairground-landing`; any Puya-specific gotcha →
`puya-gotchas`; auditing a contract → `smart-contract-audit`.

## Compacting

Preserve, in priority order: current task (requested/done/remaining); which facts were actually
re-verified against code vs. trusted from a doc (this repo has several docs that disagree with the
code); modified files; last test results; commit state (branch, last hash, uncommitted files);
authorization scope for anything on-chain, deploy or publish; next steps.

## Personal layer

Local URLs, VPS/SSH shortcuts, and anything that would be noise in a shared-source file go to
`CLAUDE.local.md`, never here. That file doesn't exist yet, and `.gitignore` has no rule for it —
add one before creating it.
