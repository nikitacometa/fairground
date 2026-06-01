# Fairground Contracts

AlgoKit workspace containing the Puya smart contracts for the Fairground platform.

**Toolchain:** algorand-python 3.5.0, puyapy 5.8.1, algokit 2.10.2 CLI.
**Test framework:** algorand-python-testing 1.1.0.
**Artifact format:** ARC-56 JSON (puyapy 5.8.1 default output).

This package is a Python-only AlgoKit workspace. It is not a pnpm package and is
not included in `pnpm-workspace.yaml`. AlgoKit manages it independently via
`.algokit.toml`.

---

## Contracts

### HouseTreasury

Shared ALGO pool for all Fairground games. Must be deployed first — game contracts
depend on it for all payouts.

**Key properties:**

- `max_payout_bps`: ceiling per payout as basis points of live balance. Default 100 (1%).
  Enforced at `resolve()` time, not at bet time.
- `emergency_pause`: halts all game payouts when set to 1.
- `registered_games`: BoxMap of authorized game contracts. Only registered apps can call `pay_winner()`.
- `get_available_balance()`: readable via `simulate()` from TS keeper/frontend before accepting bets.

**Box MBR per registered game:** 2,500 + 400 \* (5 prefix + 32 key + 8 value) = 20,500 microALGO.

### CoinflipContract

VRF-backed coin flip game (~170 lines). Depends on HouseTreasury for all payouts.

**Game flow:**

1. Player submits a 2-transaction atomic group: payment (bet + box MBR) + `flip(salt_hash, referrer)`.
2. `flip()` commits to VRF beacon round = current_round + 8 (~22 seconds). Player state is stored in a box.
3. After the commit round passes, anyone calls `resolve(player)`. The keeper calls it automatically;
   players can self-resolve.
4. Outcome: `sha256(beacon_output || salt_hash)[0] % 2`. 0 = loss, 1 = win.
5. On win: net payout = bet _ 2 _ 9800 / 10000 (2% house edge). Referral = 0.25% of gross bet if referrer set.
6. On loss: bet stays in HouseTreasury.
7. 48-hour player-triggered refund backdoor: if the commit round has passed by 34,560 rounds and the
   keeper has not resolved, the player calls `refund()` to recover their bet.

**VRF beacon:** mainnet app ID 947957720 (Applied Blockchain). Override per-deployment for testnet/LocalNet via `set_beacon_app_id()`.

**Box storage per player:** key = address (32 bytes), value = FlipState struct (49 bytes).
MBR = 2,500 + 400 \* (5 prefix + 32 + 49) = 34,900 microALGO (rounded to 35,000 in comments).

**Jackpot hook:** `jackpot_bps` global state defaults to 0. No jackpot logic executes in v1.
Enable in v1.2 after measuring daily bet volume via `set_jackpot_bps()`.

### LeaderboardContract

Cross-game leaderboard. Records wins, losses, total volume, and jackpot hits per wallet.
Called by game contracts via inner app call after every resolution. Disabled by default
until deployed and registered (coinflip's `leaderboard_app_id` defaults to 0).

**Box storage per wallet:** key = address (32 bytes), value = WalletStats struct (56 bytes).
MBR per entry = 2,500 + 400 \* (6 prefix + 32 + 56) = 37,700 microALGO.

---

## Setup

```bash
cd packages/contracts

# Install Python dependencies (requires Python >=3.12)
pip install algorand-python==3.5.0 puyapy==5.8.1 algorand-python-testing==1.1.0

# Or via poetry (pyproject.toml):
poetry install
```

---

## Compile

```bash
cd packages/contracts

# Compile all contracts to ARC-56 artifacts (outputs to artifacts/)
algokit compile python smart_contracts/

# Individual contract:
algokit compile python smart_contracts/house_treasury/
algokit compile python smart_contracts/coinflip/
algokit compile python smart_contracts/leaderboard/
```

Compiled artifacts are written to `packages/contracts/artifacts/` as `*.arc56.json` files.
These are auto-generated — never edit by hand.

### ARC-56 vs ARC-32 note

puyapy 5.8.1 outputs ARC-56 JSON by default. `algokit-client-generator@6.0.1` describes
itself as "ARC-0032" in the npm description. Verify acceptance before committing to the
pipeline (see open question in `arch-spec.json`). If the generator rejects ARC-56, add
`--output-arc32` to the compile command:

```bash
puyapy smart_contracts/ --output-arc32 --out-dir artifacts/
```

---

## Generate TypeScript Clients

After compiling, regenerate the typed TS clients consumed by `@fairground/sdk`:

```bash
cd packages/contracts

algokit generate client artifacts/ --output ../../packages/sdk/src/clients/
```

Generated files land in `packages/sdk/src/clients/`. Never edit them by hand.
Regenerate whenever a contract interface changes (method signatures, struct fields).

---

## Run Tests

### Offline unit tests (no LocalNet required)

```bash
cd packages/contracts
python -m pytest tests/ -v
```

Most tests are currently skipped (`pytest.skip("TODO")`) pending
`algopy_testing_context()` fixture setup. Remove skips as you implement fixtures.

### LocalNet integration tests

```bash
# Start LocalNet (requires Docker)
algokit localnet start

# Run all tests including LocalNet-tagged tests
LOCALNET=1 python -m pytest tests/ -v -m "not localnet or localnet"

# Run only LocalNet tests
LOCALNET=1 python -m pytest tests/ -v -m localnet
```

LocalNet tests require:

- HouseTreasury deployed and funded with at least 2,000 ALGO.
- CoinflipContract deployed and registered with HouseTreasury.
- VRF beacon stub deployed on LocalNet.

Reset LocalNet between test runs:

```bash
algokit localnet reset
```

---

## Kill-the-Mutant Verification

Required before every commit that changes contract logic:

1. Comment out a key assertion in the SUT. Examples:
   - `HouseTreasury.pay_winner()`: remove the solvency invariant assert.
   - `CoinflipContract.resolve()`: remove the `if state.claimed.native: return` guard.
   - `CoinflipContract.refund()`: remove the `elapsed >= REFUND_WINDOW_ROUNDS` assert.
2. Run `python -m pytest tests/ -v`.
3. Confirm at least one test fails for the removed assertion.
4. Re-add the assertion.

If no test fails, add a test that catches that specific assertion before continuing.

---

## Deploy

See `smart_contracts/deploy_config.py` for the deploy sequence.

**Deploy order is fixed:**

1. HouseTreasury (no dependencies)
2. LeaderboardContract (no contract dependencies)
3. CoinflipContract (depends on HouseTreasury + optional Leaderboard)

**Post-deploy steps:**

- Register CoinflipContract in HouseTreasury: `treasury.register_game(coinflip_app_id)`.
- Register CoinflipContract in LeaderboardContract: `leaderboard.register_caller(coinflip_app_id)`.
- Enable leaderboard on CoinflipContract: `coinflip.set_leaderboard_app_id(leaderboard_app_id)`.
- Fund HouseTreasury with at least 2,000 ALGO before public announcement.
- Fund HouseTreasury with 5,000–10,000 ALGO before Algorand Foundation amplification.

Environment variables for deploy:

| Variable            | Default            | Notes                                        |
| ------------------- | ------------------ | -------------------------------------------- |
| `ADMIN_MNEMONIC`    | —                  | Required. Deployer wallet.                   |
| `ALGOD_SERVER`      | `http://localhost` | Algod endpoint.                              |
| `ALGOD_PORT`        | `4001`             | Algod port.                                  |
| `ALGOD_TOKEN`       | `aaaa...a`         | LocalNet default. Empty string for AlgoNode. |
| `MIN_BET_MICROALGO` | `500000`           | 0.5 ALGO.                                    |
| `MAX_BET_MICROALGO` | `500000`           | 0.5 ALGO for v1.                             |

VRF beacon app IDs:

- **Mainnet:** 947957720 (Applied Blockchain, verified)
- **Testnet:** verify via `algorand` MCP (`api_algod_get_application_by_id`) before hardcoding.

---

## Artifacts

`artifacts/` contains compiled ARC-56 JSON. This directory is committed to git
so that `packages/sdk` can regenerate TS clients without a full compile step in CI.
Files are auto-generated — never edit directly.

Expected files after compile:

- `artifacts/house_treasury.arc56.json`
- `artifacts/coinflip.arc56.json`
- `artifacts/leaderboard.arc56.json`
