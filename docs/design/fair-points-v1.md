# FAIR Points v1 — coin clicker during the seal wait

> Source: founder idea + marketing spec `cometa-strategy/strategy/fairground/28-coin-clicker-spec.md` (CS-040).
> Status: building (2026-06-11). Game weight in any future token allocation is set by the founder
> and published BEFORE season end; this doc is the canonical formula.

## What we want

The ~30s VRF seal window is the player's peak-arousal moment — their stake is live and there is
nothing to do. Turn that wait into a micro-fidget: tapping the 3D coin earns **FAIR points**,
the platform-wide play score that a future FAIR token distribution will read from. Taps are
seasoning, not the meal — tap-to-earn as a primary engine is a proven dead end (Notcoin −80%,
HMSTR $560M→~0), so the weight is deliberately tiny and the earning is gated by real play.

## Earning rules (the published formula)

| Source                                   | Points                      | Notes                                                                                        |
| ---------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| Resolved flip (win **or** loss)          | **+100**                    | Points for playing, not for winning. Refunded/failed flips earn 0.                           |
| Tap during **your own** flip's seal wait | **+1**                      | Capped at **100 counted taps per flip**. Display keeps counting past the cap; accrual stops. |
| Golden tap                               | **×10** (that tap pays +10) | Exactly **one** hidden golden index per flip, see below. Max tap points per flip = 109.      |

**Total = 100 × resolved flips + Σ tap points** (both sums over flips with outcome `win`/`loss` only).

### Golden tap derivation (deterministic, auditable)

```
goldenIndex(sessionId) = (uint32_be(sha256("fairtap:" + sessionId)[0..4]) % 100) + 1   // 1..100
tapPoints(sessionId, taps) = min(taps, 100) + (min(taps, 100) >= goldenIndex ? 9 : 0)
```

The session UUID is server-generated at bet registration, so the index is unpredictable before
the flip is committed but verifiable by anyone afterwards. Client and server compute the same
function independently — the client only for the flash effect, the server for the points that
count. No tap-order or timing dependence: points are a pure function of (sessionId, final count),
so lost/replayed batches can never change the result.

## Anti-sybil / trust model

- Taps count **only** while the tapper's own flip is sealing → farming taps requires real stakes
  through the 3% house edge. With the 100-tap cap, botting is economically pointless.
- The tap count itself is client-reported (same trust tier as `recordBet`) but bounded three ways:
  hard cap 100, server-side rate check `accepted ≤ 15 × elapsed_seconds + 1`, and the session
  ownership + liveness gate (writes accepted only while the bet is `pending`, plus a 2-minute
  grace after resolve so the final client flush lands).
- The client sends the **absolute** session tap count, the server stores `max(stored, accepted)` —
  idempotent, monotonic, retry/multi-tab safe.
- **Bettor-only writes**: session ids are publicly discoverable (`GET /games/:gameId/active/:address`)
  and `recordBet` is unauthenticated, so neither can authorize a tap write. Instead the write
  requires the flip's **salt preimage**: the client generates 32 random bytes at flip time and
  only `sha256(salt)` ever leaves the device (on-chain box + `bets.salt_hash`). The server checks
  `sha256(salt) == salt_hash` — proof the writer is the device that placed the flip, with no
  wallet prompt and no server-side secret. The preimage plays no other role in the game
  (`resolve()` hashes `beaconOutput || salt_HASH`), so revealing it leaks nothing. A flip
  recovered on a device that never placed it has no preimage; its clicker stays off rather than
  showing points that cannot bank.
- Weight: tap points enter any season pool at ≤2–5% total (founder sets the number; published
  before season end).

## Storage

Two columns on `bets` (no new table): `taps` (raw accepted count) and `tap_points` (computed at
write time via the formula). Totals are aggregated on read.

## API

| Route                                           | Purpose                                                                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /games/:gameId/taps/:sessionId` `{count}` | Absolute-count upsert. Validates session exists + pending/2-min grace; clamps to cap + rate; recomputes `tap_points`. Returns `{taps, tapPoints, goldenIndex}`. |
| `GET /points/:address`                          | `{flips, flipPoints, taps, tapPoints, totalPoints, rank}` for the wallet.                                                                                       |
| `GET /points/leaderboard?limit=50`              | Ranked totals with NFD names. Redis-cached 30s.                                                                                                                 |

## UI

- **Pending phase**: the whole coin canvas is the tap target (`pointerdown` — forgiving on
  mobile; the coin's own click-pop/drag behaviors are untouched). Each tap: floating `+1` at the
  pointer, tick sfx, light haptic. Golden tap: `×10` burst + ring flash + stronger haptic.
  Session meter under the coin: `◈ FAIR +37`, scale-pop per tap, combo glow on rapid streaks,
  `100/100 · banked` state past the cap (floats become sparks, no fake numbers).
- **Resolved screen**: one quiet line — `◈ +100 FAIR · +N from taps`.
- **Idle**: lifetime total chip near the title (`◈ 1,240 FAIR`), fetched on connect, links to
  the points board.
- **Leaderboard page**: second ranking view (`?board=fair`) — same layout, ranked by FAIR points.
- **Demo mode**: full visuals with a fake session id, zero server writes.

## NOT in v1

Upgrades, idle accrual, prestige, a separate clicker page/tab, taps on the proof card, WS
broadcast of tap activity, any on-chain accounting of points.

## Success metrics (review after ~1 week)

% of flips with ≥1 tap (>50% = deepen), avg taps/flip, re-flip rate within 2 min of settle.
