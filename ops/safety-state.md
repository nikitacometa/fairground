# Fairground Safety State

Real-time operational state. Update on every relevant event. Last verified on-chain: 2026-06-04 (round ~61,820,392).

## House Treasury (live mainnet)

| Field                            | Value                                                        | Source              |
| -------------------------------- | ------------------------------------------------------------ | ------------------- |
| Network                          | mainnet                                                      | —                   |
| Treasury App ID                  | `3584287403`                                                 | deployed 2026-06-02 |
| Treasury App Addr                | `2X6NWTG3EC7QE2T2IOTYIPTEE4AYSGT47SCIZCA3Q3SGAPBBTTLIV2WHPY` | —                   |
| Coinflip App ID                  | `3585680948` (v1, edge 3% → 1.94x)                           | deployed 2026-06-03 |
| Coinflip App Addr                | `O6K6IM7FRTTPTBJ7YEMUMEGY3YDNDWLGNPLZXGXKNVMRUKRU7NJHBSLRTY` | —                   |
| Treasury Balance                 | **4.28 ALGO** (spendable ~4.12 after min-balance)            | algod 2026-06-04    |
| Max Payout BPS                   | **1000 (10% of spendable)** — verified on-chain global state | algod 2026-06-04    |
| total_deposited / total_paid_out | 4.0 ALGO / 0.782 ALGO                                        | algod 2026-06-04    |
| Paused                           | false                                                        | algod 2026-06-04    |
| Bet size                         | 0.1 ALGO (min = max; raising = contract param change)        | —                   |

### Solvency note (corrected 2026-06-04)

`pay_winner()` caps a single payout at `max_payout_bps` (1000 = **10%**) of spendable. At the
current 4.12 ALGO spendable that ceiling is **0.41 ALGO**; a 0.1-ALGO win pays 0.194 ALGO, so
**wins currently settle**. The earlier "every win reverts" reading assumed the contract default
of 1% — the deployed value is 10%. Still seed to **100–200 ALGO** before any public push: the
4-ALGO buffer absorbs only ~20 net wins and won't support a higher max_bet.

**Not implemented:** keeper auto-pause below `TREASURY_MIN_BALANCE_MICROALGO` (audit H-8). Until
M2 lands, treasury depletion is silent — watch the balance manually.

## Keeper Status (live)

| Field         | Value                                                         |
| ------------- | ------------------------------------------------------------- |
| Primary       | running (Docker `fairground-keeper-primary`, restart: always) |
| Standby       | running (`fairground-keeper-standby`)                         |
| Lock          | Redis SETNX, 10s TTL, refreshed 4s                            |
| DB migrations | applied on startup (wired M0 2026-06-04)                      |

## VRF Beacon

- Mainnet: app ID **`1615566206`** (Applied Blockchain, live). The 2022-era `947957720` is DEAD.
- Beacon emits VRF outputs only for rounds that are multiples of 8; `must_get()` panics otherwise.
- Retention: last 189 outputs (~70 min). Keeper SLA: resolve within ~60 min of commit_round.

## Thresholds

| Alert                | Threshold                  | Action                           | Status                    |
| -------------------- | -------------------------- | -------------------------------- | ------------------------- |
| Treasury below floor | < 2000 ALGO                | auto-pause via keeper            | **NOT implemented (H-8)** |
| Session unresolvable | > 60 min from commit_round | alert; refund at 48h             | escalation pending (H-4)  |
| Keeper lock lost     | > 10s without refresh      | standby auto-promotes            | working                   |
| Beacon round stale   | > 189 rounds since commit  | `must_get()` panics; refund path | escalation pending (H-4)  |

## Pre-public-launch checklist

- [x] Contracts deployed + verified on mainnet (treasury, coinflip)
- [x] Keeper resolves sessions on mainnet (proven end-to-end)
- [ ] **Geo-block live at the edge (Cloudflare), TH block tested** — deferred (owner)
- [ ] Treasury seeded to 100–200 ALGO — pending (owner)
- [ ] Admin key separated from keeper hot key (audit H-6)
- [ ] Monitoring/alerting on keeper + treasury (audit H-7)
- [x] House wallet mnemonic in `runtime.config`, never in git
