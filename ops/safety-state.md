# Fairground Safety State

Real-time operational state. Update on every relevant event.

## House Treasury

| Field | Value | Updated |
|-------|-------|---------|
| Network | testnet | 2026-05-31 |
| Treasury App ID | not deployed | - |
| Coinflip App ID | not deployed | - |
| Treasury Balance | 0 ALGO | - |
| Max Payout BPS | 100 (1% of balance) | - |
| Paused | false | - |

## Keeper Status

| Field | Value |
|-------|-------|
| Primary | not running |
| Standby | not running |
| Pending sessions | 0 |
| Last resolved | never |
| Lock held by | - |

## Deploy Checklist (before mainnet)

- [ ] Contract compilation: `algokit compile python smart_contracts/` passes
- [ ] Testnet deploy verified (all 3 contracts)
- [ ] Keeper resolves sessions within 60 min on testnet (beacon retention SLA)
- [ ] Geo-block active and verified (TH block tested)
- [ ] Treasury funded: 2000 ALGO minimum before public announcement
- [ ] Treasury funded: 5000-10000 ALGO before Foundation amplification
- [ ] House wallet mnemonic in Docker Compose env (never in git)
- [ ] Domain DNS -> Cloudflare proxy enabled
- [ ] WALLETCONNECT_PROJECT_ID registered

## Thresholds

| Alert | Threshold | Action |
|-------|-----------|--------|
| Treasury below floor | < 2000 ALGO | Auto-pause via keeper |
| Session unresolvable | > 60 min from commit_round | Alert; player refund available at 48h |
| Keeper lock lost | > 10s without refresh | Standby auto-promotes |
| Beacon round stale | > 189 rounds since commit | must_get() will panic; trigger refund path |

## VRF Beacon

- Mainnet: app ID 947957720 (confirmed live 2026-05-30)
- Testnet: app ID 110096026 (confirm before testnet integration tests)
- Retention: last 189 outputs (~70 min)
- Keeper SLA: resolve within 60 min of commit_round passing
