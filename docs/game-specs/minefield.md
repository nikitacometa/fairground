# Algo Minefield Game Spec

**Contract name:** `MinefieldContract`  
**Source:** `packages/contracts/smart_contracts/minefield/` (v2, not in initial scaffold)  
**Build target:** Weeks 2-10 after CoinFlip launch  
**House pool prerequisite:** 5,000 ALGO minimum in treasury before any public announcement

## Core Loop

1. Player selects bomb count (1-10) and bet amount (0.5-20 ALGO).
2. Player submits a salt hash (random bytes, kept client-side for verification).
3. Contract atomically: receives payment, records session, commits to VRF beacon round N+8.
4. The full 25-cell board is cryptographically fixed from that single VRF commitment — zero per-reveal oracle calls after this point.
5. Player reveals cells one at a time. Each reveal checks the pre-computed bomb map.
6. Safe reveal: multiplier grows per the actuarially-fair table. Player can cashout at any point.
7. Cashout: contract fires immediate inner ALGO transfer to player at current multiplier.
8. Bomb hit: session ends, bet forfeited to treasury.
9. Full board clear (25 - bomb_count reveals with no bombs): jackpot eligibility regardless of VRF mod condition.
10. Session end: proof card generated showing full bomb map, VRF output, beacon round, player salt.

**Self-attribution mechanism:** The player attributes each bomb hit to their specific cell choice, not to the VRF commitment that was made before the first reveal. The "I should have stopped at cell 18" thought loop drives the next session. This is variable-ratio reinforcement with perceived agency — the same behavioral mechanism as slots, but the player believes their decisions matter. They do not: the bomb layout was fixed at step 3.

## Contract Responsibilities

**Box storage per session:**

```
key:   player_address (32 bytes)
value: vrf_round (uint64)          # committed beacon round
       bet_amount (uint64)         # in microALGO
       bomb_count (uint8)          # 1-10
       salt_hash (bytes32)         # player-provided, for proof verification
       revealed_bitmap (uint32)    # 25 bits, one per cell
       bombs_remaining (uint8)     # decrements on bomb hit
       current_multiplier_e4 (uint32)  # multiplier * 10000 (fixed-point)
       claimed (bool)              # true after cashout or bomb hit
       jackpot_eligible (bool)     # true after full board clear
```

Box MBR: `2500 + 400 * (32 + 89)` = 2,500 + 48,400 = 50,900 microALGO. Round up to 51,000 microALGO funded by the player's payment transaction (separate from bet amount).

**Global state:**

```
house_treasury_app_id (uint64)
leaderboard_app_id (uint64)
jackpot_balance (uint64)       # microALGO in jackpot accumulator
jackpot_rate_bps (uint16)      # 100 = 1%
leaderboard_rate_bps (uint16)  # 50 = 0.5%
referral_rate_bps (uint16)     # 50 = 0.5%
min_bet (uint64)
max_bet (uint64)               # 20 ALGO in v2
paused (bool)
```

**ABI methods:**

```python
@arc4.abimethod
def start_game(self, salt_hash: Bytes32, bomb_count: UInt8, referrer: arc4.Address) -> UInt64:
    # Returns session_id (= committed_round)
    # Validates: not paused, bet in [min_bet, max_bet], bomb_count in [1,10]
    # Validates: no existing active session for this player
    # Records session box with committed_round = current_round + 8
    # Emits GameStarted(player, committed_round, bet_amount, bomb_count)

@arc4.abimethod
def reveal_cell(self, cell_index: UInt8) -> CellResult:
    # cell_index: 0-24 (row-major, 5x5 grid)
    # Validates: session exists, cell not yet revealed, session not claimed
    # On first reveal: reads VRF beacon output for committed_round
    #   → computes bomb_layout = deterministicLayout(beacon_output, bomb_count)
    # Checks if cell_index is in bomb_layout
    # Safe: marks cell revealed, increments multiplier, emits CellRevealed(safe)
    # Bomb: sets claimed=true, deletes box, emits GameLost
    # Emits CellRevealed(player, cell_index, is_bomb, current_multiplier)

@arc4.abimethod
def cashout(self) -> UInt64:
    # Returns payout in microALGO
    # Validates: session exists, at least one cell revealed, not claimed
    # Reads HouseTreasury.get_available_balance() — foreign app ref
    # Enforces: payout <= treasury_live_balance * max_payout_bps / 10000
    # Inner ALGO transfer to player at current_multiplier
    # Referral: if referrer != zero_address, inner transfer 0.5% to referrer
    # Jackpot: accumulate jackpot_rate_bps% of bet to jackpot_balance
    # LeaderboardContract.record_result() via inner app call
    # Sets claimed=true, deletes box
    # Emits GameWon(player, payout, cells_revealed, bomb_count)

@arc4.abimethod
def forfeit(self) -> None:
    # Player voluntarily ends session (walked away)
    # Same as losing: no payout, deletes box

@arc4.abimethod
def refund(self, player: arc4.Address) -> None:
    # Available after 61,714 rounds (~48h at ~2.8s/block) since committed_round with no activity
    # Permissionless — any wallet can trigger
    # Returns bet + MBR to player directly from the game contract's own balance
    # (never touches house treasury — works even when treasury is paused)
    # Deletes box
```

## VRF Flow

```
block N:     player calls start_game(salt_hash, bomb_count)
             committed_round = N + 8
             bomb layout NOT computable yet — beacon output unknown

block N+8:   VRF beacon computes output for round N+8

block N+8+:  player calls reveal_cell(0)
             FIRST reveal triggers beacon read:
               contract makes inner app call to beacon app 947957720
               reads beacon.output(N+8) synchronously
               computes bomb_layout = deterministicLayout(beacon_output, bomb_count)
             subsequent reveals use cached bomb_layout (or re-derive deterministically)
             no additional oracle calls after first reveal

if keeper fails ~48h (61,714 rounds at ~2.8s/block): player calls refund() permissionlessly
```

**Deterministic cell expansion:**

```typescript
// In packages/sdk/src/vrf/beacon.ts
function deterministicLayout(vrfOutput: Uint8Array, bombCount: number): number[] {
  // Fisher-Yates shuffle of [0..24] seeded by vrfOutput
  // Returns first bombCount elements as bomb positions
  // Deterministic: same vrfOutput + bombCount always produces same layout
  // Verifiable: player can reproduce layout from vrfOutput + their salt
  const cells = Array.from({ length: 25 }, (_, i) => i);
  const seed = new DataView(vrfOutput.buffer);
  for (let i = 24; i > 0; i--) {
    const j = Number(seed.getBigUint64(i % (vrfOutput.length - 7))) % (i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, bombCount);
}
```

This function is the bridge between the on-chain VRF output and the client-side cell map visualization. It must be identical in the Puya contract (Python) and the TS SDK. Test both implementations against the same test vectors.

## Multiplier Table

The multiplier grows with each safe reveal. The actuarially fair multiplier for K safe reveals with N bombs on a 25-cell board:

```
P(K safe reveals) = C(25-N, K) / C(25, K)

Fair multiplier = 1 / P(K safe reveals)
House multiplier = fair_multiplier * (1 - house_edge)
                 = fair_multiplier * 0.98
```

| Bombs | Reveal 1 | Reveal 2 | Reveal 5 | Reveal 10 | Full board |
| ----- | -------- | -------- | -------- | --------- | ---------- |
| 1     | 1.04x    | 1.08x    | 1.23x    | 1.79x     | 24.50x     |
| 3     | 1.12x    | 1.27x    | 1.98x    | 8.49x     | ~600x      |
| 5     | 1.22x    | 1.52x    | 3.32x    | ~50x      | ~5000x     |
| 10    | 1.62x    | 2.83x    | ~35x     | jackpot   | N/A        |

Full board clear with 5 bombs: ~0.01% probability. At 200 sessions/day, this fires roughly once every 500 days. With 5,000 sessions/day, once every 20 days. This is the jackpot-triggering event regardless of VRF mod condition.

All multipliers stored in the contract as `uint32` fixed-point (`value * 10000`). The Puya contract must match this table exactly — test the computation with the algorand-python-testing suite against the above values.

## Bankroll Sizing

Max bet for Minefield is 20 ALGO. Solvency invariant: payout <= 1% of live treasury balance at cashout time.

| Treasury    | Max bet | Max single payout | Concurrent max-bet full-board clears before pause |
| ----------- | ------- | ----------------- | ------------------------------------------------- |
| 5,000 ALGO  | 20 ALGO | 50 ALGO           | ~100 (with 5-bomb board)                          |
| 10,000 ALGO | 20 ALGO | 100 ALGO          | ~200                                              |

**Adversarial scenario:** Three concurrent full-board clears at 5 bombs each (joint probability ~0.000001%). Each pays ~5,000x the bet from the multiplier table, but the contract caps at 1% of live treasury. At 5,000 ALGO treasury: cap = 50 ALGO per session. Three concurrent: ~150 ALGO total. Treasury drops to ~4,850 ALGO. Auto-pause does not trigger (threshold is 2,000 ALGO). This scenario is safe.

**Critical:** Enforce `max_payout_bps` at cashout time against the live treasury balance, not against the balance at game start. If a viral spike drains the treasury between start and cashout, the solvency invariant must still hold.

## Proof Card Fields

PNG generated by `@fairground/proof-card`. Template: `MinefieldResultCard` (add to proof-card package in v2).

| Field            | Source                                                         |
| ---------------- | -------------------------------------------------------------- |
| Game             | Algo Minefield                                                 |
| Outcome          | WON / LOST / CASHED OUT                                        |
| Cells revealed   | count                                                          |
| Bomb count       | user-selected                                                  |
| Payout           | in ALGO                                                        |
| Full bomb map    | deterministicLayout(vrfOutput, bombCount) rendered as 5x5 grid |
| Beacon round     | committed_round                                                |
| VRF output hash  | sha256 of beacon output                                        |
| Player salt      | provided by player (for verification)                          |
| Transaction ID   | cashout/end txn                                                |
| Verification URL | `algoexplorer.io/tx/{txnId}`                                   |

The full bomb map on the proof card is the most shareable element in the set. "Here is where every bomb was before I touched the board" is a story no centralized casino can tell. Full-board-clear proof cards show 0 bombs on the revealed map — the rarest possible artifact.

## API Surface

Same API package as CoinFlip. Additional endpoints:

**POST `/games/minefield/sessions`**  
Body: `{ wallet, txnId, sessionId, bombCount }`  
Creates pending session in Postgres.

**POST `/games/minefield/sessions/:sessionId/reveals`**  
Body: `{ wallet, cellIndex, txnId }`  
Records reveal. Returns updated session state with current multiplier.

**GET `/games/minefield/sessions/:sessionId`**  
Returns full session state including revealed bitmap, current multiplier, bomb_count, status.

**WS `/ws` events:**

- `{ type: 'cell_revealed', sessionId, cellIndex, isBomb, multiplier }`
- `{ type: 'game_won', sessionId, payout, proofCardUrl }`
- `{ type: 'game_lost', sessionId, cell_index }`
- `{ type: 'jackpot', winner, amount }`

## Frontend Surface (apps/game)

**`/minefield` — Game page (client component)**

- Bomb count selector: 1-10 (slider or segmented control)
- Bet input: 0.5-20 ALGO
- Start button: disabled until wallet connected
- 5x5 grid canvas: cells unrevealed initially (face-down cards or fog tiles)
- Per-reveal animation: cell flip reveals safe/bomb
- Multiplier display: grows with each safe reveal, highlighted in amber
- Cashout button: enabled after first safe reveal, disabled during pending reveal
- VRF round indicator: shows committed round and current round (proof that layout is locked)
- Session timer: 48h countdown (refund window)
- Proof card modal: shown on session end (win, loss, or cashout). Shows full bomb map.

**Cashout UX note:** The cashout button must be responsive — player taps it, the transaction fires immediately. Any delay between tap and transaction confirmation creates "I wanted to cashout at 3x but it resolved at 4x" disputes. Use optimistic UI: disable the button immediately on tap, show the transaction hash, then show the result.

**Mobile:** Pera deep-links handle the wallet signature. The 5x5 grid must be fully usable on a 375px wide screen (the Pera app primary use case for Algorand mobile users).
