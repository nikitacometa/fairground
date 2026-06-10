"""
Tests for FairJackpot (the Daily Pot vault).

Kill-the-mutant check: before committing, comment out a key line in the SUT
(e.g., the `pot_balance += jackpot_cut` credit in accrue(), the hint==0 branch in
resolve_draw(), or the params snapshot in commit_draw()) and confirm that at
least one test here fails. Re-add before pushing.

Uses algorand-python-testing==1.1.0 offline context (no LocalNet required).
The VRF beacon abi_call is isolated behind the _read_beacon subroutine seam and
monkeypatched here -- this is what unlocks full draw happy-path coverage offline.
"""

from __future__ import annotations

import hashlib

import pytest
import algosdk
import algosdk.logic
from algopy_testing import algopy_testing_context
import algopy
from _algopy_testing.primitives import UInt64
from _algopy_testing.itxn import PaymentInnerTransaction

from smart_contracts.fairjackpot.contract import (
    FairJackpot,
    BEACON_SETTLE_BUFFER,
    BPS_DENOMINATOR,
    DEFAULT_BACKSTOP,
    DEFAULT_RUNNER_BPS,
    DEFAULT_RUNNER_COUNT,
    DEFAULT_WINNER_BPS,
    ENTRIES_PER_PAGE,
    EPOCH_SECONDS,
    FLOAT_RESERVE,
    PAGE_BOX_MBR,
    PLAYER_BOX_MBR,
    RECOMMIT_AFTER_ROUNDS,
    TICKET_UNIT,
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

BEACON_APP_ID = 4002
GAME_APP_ID = 4003
OTHER_GAME_APP_ID = 4004
FIRST_CLOSE_TS = 2_000_000_000  # far-future unix ts; tests patch latest_timestamp around it
START_TS = 1_999_990_000
JACKPOT_BPS = 150


def _gen_addr() -> str:
    _, addr = algosdk.account.generate_account()
    return addr


def _game_addr(app_id: int = GAME_APP_ID) -> str:
    return algosdk.logic.get_application_address(app_id)


def _pot_addr(contract: FairJackpot) -> str:
    return algosdk.logic.get_application_address(contract.__app_id__)


def _deploy_pot(ctx, admin: str, first_close_ts: int = FIRST_CLOSE_TS) -> FairJackpot:
    """Deploy a funded FairJackpot with one registered game in slot 1."""
    ctx.any.application(id=BEACON_APP_ID)
    ctx.any.application(id=GAME_APP_ID)
    ctx.ledger.patch_global_fields(latest_timestamp=START_TS)
    contract = FairJackpot()
    contract.create(
        admin=algopy.arc4.Address(admin),
        beacon_app_id=algopy.arc4.UInt64(BEACON_APP_ID),
        first_close_ts=algopy.arc4.UInt64(first_close_ts),
    )
    contract.set_game(algopy.arc4.UInt64(1), algopy.arc4.UInt64(GAME_APP_ID))
    _fund_pot(ctx, contract)
    return contract


def _fund_pot(ctx, contract: FairJackpot, balance: int = 50_000_000) -> None:
    """Give the pot app its operational float (box MBR + FLOAT_RESERVE headroom)."""
    ctx.ledger.update_account(
        _pot_addr(contract),
        balance=UInt64(balance),
        min_balance=UInt64(100_000),
    )


def _accrue(
    ctx,
    contract: FairJackpot,
    player: str,
    amount: int,
    cut: int | None = None,
    game_app_id: int = GAME_APP_ID,
) -> None:
    """Call accrue() as the registered game app (inner-call sender emulation)."""
    if cut is None:
        cut = amount * JACKPOT_BPS // 10_000
    with ctx.txn.create_group(
        active_txn_overrides={"sender": algopy.Account(_game_addr(game_app_id))}
    ):
        contract.accrue(
            player=algopy.arc4.Address(player),
            amount=algopy.arc4.UInt64(amount),
            jackpot_cut=algopy.arc4.UInt64(cut),
        )


def _tickets(contract: FairJackpot, epoch: int, player: str) -> int:
    return contract.get_player_tickets(
        algopy.arc4.UInt64(epoch), algopy.arc4.Address(player)
    ).native


def _commit(ctx, contract: FairJackpot, at_ts: int | None = None) -> None:
    ctx.ledger.patch_global_fields(latest_timestamp=at_ts or FIRST_CLOSE_TS)
    contract.commit_draw()


def _beacon_for_winner_ticket(total: int, want_ticket_for_slot0: int) -> bytes:
    """Brute-force a 32-byte beacon output whose slot-0 ticket == want (mod total)."""
    for k in range(100_000):
        candidate = hashlib.sha256(b"seed" + k.to_bytes(8, "big")).digest()
        w0 = int.from_bytes(
            hashlib.sha256(candidate + (0).to_bytes(8, "big")).digest()[:8], "big"
        ) % total
        if w0 == want_ticket_for_slot0:
            return candidate
    raise AssertionError("no beacon candidate found")


def _slot_ticket(beacon: bytes, slot: int, total: int) -> int:
    return int.from_bytes(
        hashlib.sha256(beacon + slot.to_bytes(8, "big")).digest()[:8], "big"
    ) % total


def _patch_beacon(monkeypatch, beacon: bytes) -> None:
    monkeypatch.setattr(
        FairJackpot, "_read_beacon", lambda self, commit_round: algopy.Bytes(beacon)
    )


def _entry(ctx, contract: FairJackpot, epoch: int, entry_idx: int) -> tuple[str, int]:
    """Read a ledger page entry (address, cum_after) straight from box storage."""
    page = entry_idx // ENTRIES_PER_PAGE
    offset = (entry_idx % ENTRIES_PER_PAGE) * 40
    key = b"p" + epoch.to_bytes(8, "big") + page.to_bytes(8, "big")
    raw = bytes(ctx.ledger.get_box(contract, key))
    addr = algosdk.encoding.encode_address(raw[offset : offset + 32])
    cum = int.from_bytes(raw[offset + 32 : offset + 40], "big")
    return addr, cum


def _resolve(ctx, contract: FairJackpot, hints: list[int]) -> None:
    ctx.ledger.patch_global_fields(
        round=int(contract.pending_commit_round.value) + BEACON_SETTLE_BUFFER
    )
    contract.resolve_draw(
        algopy.arc4.DynamicArray[algopy.arc4.UInt64](*[algopy.arc4.UInt64(h) for h in hints])
    )


def _inner_payments(ctx) -> list[PaymentInnerTransaction]:
    return [
        t
        for group in ctx.txn.last_group.itxn_groups
        for t in group
        if isinstance(t, PaymentInnerTransaction)
    ]


# ---------------------------------------------------------------------------
# TestCreate
# ---------------------------------------------------------------------------

class TestCreate:
    def test_initial_state(self) -> None:
        """create() seeds epoch 1, default split, zeroed pending state.

        Kill-the-mutant: comment out any GlobalState assignment in create()."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            assert str(contract.admin.value) == admin
            assert int(contract.epoch_id.value) == 1
            assert int(contract.epoch_close_ts.value) == FIRST_CLOSE_TS
            assert int(contract.pot_balance.value) == 0
            assert int(contract.pending_epoch.value) == 0
            assert int(contract.winner_bps.value) == DEFAULT_WINNER_BPS
            assert int(contract.runner_bps.value) == DEFAULT_RUNNER_BPS
            assert int(contract.runner_count.value) == DEFAULT_RUNNER_COUNT
            assert int(contract.backstop_microalgo.value) == DEFAULT_BACKSTOP
            assert str(contract.game_1.value) == _game_addr()

    def test_create_rejects_past_close(self) -> None:
        """create() reverts when first_close_ts is not in the future."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            ctx.any.application(id=BEACON_APP_ID)
            ctx.ledger.patch_global_fields(latest_timestamp=START_TS)
            contract = FairJackpot()
            with pytest.raises(AssertionError, match="first close must be in the future"):
                contract.create(
                    admin=algopy.arc4.Address(admin),
                    beacon_app_id=algopy.arc4.UInt64(BEACON_APP_ID),
                    first_close_ts=algopy.arc4.UInt64(START_TS),
                )


# ---------------------------------------------------------------------------
# TestAccrue
# ---------------------------------------------------------------------------

class TestAccrue:
    def test_accrue_rejects_unregistered_caller(self) -> None:
        """Only a registered game app address may call accrue().

        Kill-the-mutant: remove the registered-game assert."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            with ctx.txn.create_group(
                active_txn_overrides={"sender": algopy.Account(player)}
            ):
                with pytest.raises(AssertionError, match="caller is not a registered game"):
                    contract.accrue(
                        player=algopy.arc4.Address(player),
                        amount=algopy.arc4.UInt64(TICKET_UNIT),
                        jackpot_cut=algopy.arc4.UInt64(15_000),
                    )

    def test_minnow_floor_first_flip_below_one_algo(self) -> None:
        """0.5 ALGO settled flip -> exactly 1 ticket (minnow floor).

        Kill-the-mutant: remove the `if target == 0: target = 1` floor."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, 500_000)
            assert _tickets(contract, 1, player) == 1
            assert int(contract.epoch_total_tickets.value) == 1
            assert int(contract.epoch_entry_count.value) == 1

    def test_one_algo_flip_is_exactly_one_ticket(self) -> None:
        """1 ALGO -> 1 ticket, not 2 (floor and minnow floor must not stack)."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            assert _tickets(contract, 1, player) == 1

    def test_accrue_credits_pot_balance(self) -> None:
        """pot_balance grows by exactly jackpot_cut on every accrue.

        Kill-the-mutant: remove the pot_balance credit in accrue() -- this is the
        review blocker where the drawn pot orphans from the real stream."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, 1_000_000, cut=15_000)
            _accrue(ctx, contract, player, 2_000_000, cut=30_000)
            assert int(contract.pot_balance.value) == 45_000

    def test_remainder_carries_within_epoch(self) -> None:
        """Sub-ALGO remainders accumulate: 0.5 + 0.4 = 0.9 -> still 1 (floor);
        + 1.2 = 2.1 -> 2 tickets total, one new delta entry."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, 500_000)
            _accrue(ctx, contract, player, 400_000)
            assert _tickets(contract, 1, player) == 1
            assert int(contract.epoch_entry_count.value) == 1  # no zero-delta entries
            _accrue(ctx, contract, player, 1_200_000)
            assert _tickets(contract, 1, player) == 2
            assert int(contract.epoch_total_tickets.value) == 2
            assert int(contract.epoch_entry_count.value) == 2

    def test_whale_gets_proportional_tickets(self) -> None:
        """20 ALGO single flip -> 20 tickets in one entry."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, 20 * TICKET_UNIT)
            assert _tickets(contract, 1, player) == 20
            assert int(contract.epoch_entry_count.value) == 1

    def test_cumulative_sums_across_players(self) -> None:
        """Delta entries carry monotonically increasing cum_after values."""
        admin = _gen_addr()
        p1, p2, p3 = _gen_addr(), _gen_addr(), _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, p1, 3 * TICKET_UNIT)   # entry 0: cum 3
            _accrue(ctx, contract, p2, 500_000)           # entry 1: cum 4 (minnow)
            _accrue(ctx, contract, p3, 5 * TICKET_UNIT)   # entry 2: cum 9
            _accrue(ctx, contract, p1, 2 * TICKET_UNIT)   # entry 3: cum 11 (delta 2)
            assert int(contract.epoch_total_tickets.value) == 11
            assert _entry(ctx, contract, 1, 0) == (p1, 3)
            assert _entry(ctx, contract, 1, 1) == (p2, 4)
            assert _entry(ctx, contract, 1, 2) == (p3, 9)
            assert _entry(ctx, contract, 1, 3) == (p1, 11)

    def test_excluded_player_gets_no_tickets_but_pot_credited(self) -> None:
        """House wallets are structurally unable to enter the lottery.

        Kill-the-mutant: remove the exclusion early-return in accrue()."""
        admin = _gen_addr()
        house = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            contract.set_excluded(algopy.arc4.UInt64(1), algopy.arc4.Address(house))
            _accrue(ctx, contract, house, 5 * TICKET_UNIT, cut=75_000)
            assert _tickets(contract, 1, house) == 0
            assert int(contract.epoch_total_tickets.value) == 0
            assert int(contract.pot_balance.value) == 75_000

    def test_mbr_exhaustion_degrades_gracefully(self) -> None:
        """With no spendable float, accrue keeps the cut and skips tickets instead
        of reverting (a revert would brick the calling game's resolve()).

        Kill-the-mutant: remove the spendable < required + FLOAT_RESERVE guard and
        this test fails because tickets get issued."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            # Drain the float: balance barely above min_balance
            ctx.ledger.update_account(
                _pot_addr(contract),
                balance=UInt64(200_000),
                min_balance=UInt64(100_000),
            )
            _accrue(ctx, contract, player, 2 * TICKET_UNIT, cut=30_000)
            assert _tickets(contract, 1, player) == 0
            assert int(contract.epoch_total_tickets.value) == 0
            assert int(contract.pot_balance.value) == 30_000  # cut still credited

    def test_mbr_guard_threshold_boundary(self) -> None:
        """Exactly enough float (player box + page box + reserve) -> tickets issue."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            needed = PLAYER_BOX_MBR + PAGE_BOX_MBR + FLOAT_RESERVE
            ctx.ledger.update_account(
                _pot_addr(contract),
                balance=UInt64(100_000 + needed),
                min_balance=UInt64(100_000),
            )
            _accrue(ctx, contract, player, TICKET_UNIT)
            assert _tickets(contract, 1, player) == 1

    def test_second_game_slot_can_accrue(self) -> None:
        """A game registered in slot 2 is authorized (cross-game by construction)."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            ctx.any.application(id=OTHER_GAME_APP_ID)
            contract.set_game(algopy.arc4.UInt64(2), algopy.arc4.UInt64(OTHER_GAME_APP_ID))
            _accrue(ctx, contract, player, TICKET_UNIT, game_app_id=OTHER_GAME_APP_ID)
            assert _tickets(contract, 1, player) == 1


# ---------------------------------------------------------------------------
# TestDepositPot
# ---------------------------------------------------------------------------

class TestDepositPot:
    def test_deposit_credits_pot(self) -> None:
        admin = _gen_addr()
        donor = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            pay = ctx.any.txn.payment(
                sender=algopy.Account(donor),
                receiver=algopy.Account(_pot_addr(contract)),
                amount=UInt64(25_000_000),
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(donor)}):
                contract.deposit_pot(pay=pay)
            assert int(contract.pot_balance.value) == 25_000_000

    def test_deposit_rejects_wrong_receiver(self) -> None:
        admin = _gen_addr()
        donor = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            pay = ctx.any.txn.payment(
                sender=algopy.Account(donor),
                receiver=algopy.Account(donor),
                amount=UInt64(25_000_000),
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(donor)}):
                with pytest.raises(AssertionError, match="payment must go to the pot"):
                    contract.deposit_pot(pay=pay)


# ---------------------------------------------------------------------------
# TestCommitDraw
# ---------------------------------------------------------------------------

class TestCommitDraw:
    def test_commit_before_close_reverts(self) -> None:
        """Kill-the-mutant: remove the now >= close gate."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            ctx.ledger.patch_global_fields(latest_timestamp=FIRST_CLOSE_TS - 1)
            with pytest.raises(AssertionError, match="epoch not closed yet"):
                contract.commit_draw()

    def test_zero_ticket_epoch_rolls_over_without_draw(self) -> None:
        """No players -> epoch advances, close advances, pot untouched, no pending.

        Kill-the-mutant: remove the total == 0 early-return."""
        admin = _gen_addr()
        donor = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            pay = ctx.any.txn.payment(
                sender=algopy.Account(donor),
                receiver=algopy.Account(_pot_addr(contract)),
                amount=UInt64(10_000_000),
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(donor)}):
                contract.deposit_pot(pay=pay)
            _commit(ctx, contract)
            assert int(contract.epoch_id.value) == 2
            assert int(contract.epoch_close_ts.value) == FIRST_CLOSE_TS + EPOCH_SECONDS
            assert int(contract.pot_balance.value) == 10_000_000
            assert int(contract.pending_epoch.value) == 0

    def test_commit_snapshots_everything(self) -> None:
        """Pot, tickets, entry count AND payout params freeze into pending_*.

        Kill-the-mutant targets: the entries-before-zeroing order bug; the params
        snapshot (set_params between commit and resolve must not affect the draw)."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, 3 * TICKET_UNIT, cut=45_000)
            _commit(ctx, contract)
            assert int(contract.pending_epoch.value) == 1
            assert int(contract.pending_total_tickets.value) == 3
            assert int(contract.pending_entry_count.value) == 1
            assert int(contract.pending_pot.value) == 45_000
            assert int(contract.pending_winner_bps.value) == DEFAULT_WINNER_BPS
            assert int(contract.pending_runner_bps.value) == DEFAULT_RUNNER_BPS
            assert int(contract.pending_runner_count.value) == DEFAULT_RUNNER_COUNT
            # current epoch reset
            assert int(contract.epoch_id.value) == 2
            assert int(contract.pot_balance.value) == 0
            assert int(contract.epoch_total_tickets.value) == 0
            assert int(contract.epoch_entry_count.value) == 0
            # commit round is beacon-aligned and ahead
            commit_round = int(contract.pending_commit_round.value)
            assert commit_round % 8 == 0
            assert commit_round >= int(algopy.Global.round) + 8

    def test_double_commit_reverts(self) -> None:
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            _commit(ctx, contract)
            ctx.ledger.patch_global_fields(latest_timestamp=FIRST_CLOSE_TS + EPOCH_SECONDS)
            with pytest.raises(AssertionError, match="draw already pending"):
                contract.commit_draw()

    def test_missed_days_skip_to_future_close(self) -> None:
        """Keeper down 3 days -> next close lands in the future, not the past.

        Kill-the-mutant: replace the periods formula with `close + EPOCH_SECONDS`."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            late = FIRST_CLOSE_TS + 3 * EPOCH_SECONDS + 600
            _commit(ctx, contract, at_ts=late)
            assert int(contract.epoch_close_ts.value) == FIRST_CLOSE_TS + 4 * EPOCH_SECONDS
            assert int(contract.epoch_close_ts.value) > late

    def test_commit_reverts_when_paused(self) -> None:
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            contract.set_paused(algopy.arc4.Bool(True))
            ctx.ledger.patch_global_fields(latest_timestamp=FIRST_CLOSE_TS)
            with pytest.raises(AssertionError, match="contract is paused"):
                contract.commit_draw()

    def test_accrue_after_commit_lands_in_new_epoch(self) -> None:
        """A flip settling in the commit->resolve window belongs to the NEW epoch:
        the drawn snapshot is untouched and no ticket is double-counted."""
        admin = _gen_addr()
        p1, p2 = _gen_addr(), _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, p1, TICKET_UNIT)
            _commit(ctx, contract)
            _accrue(ctx, contract, p2, 2 * TICKET_UNIT)
            assert int(contract.pending_total_tickets.value) == 1
            assert _tickets(contract, 1, p2) == 0
            assert _tickets(contract, 2, p2) == 2
            assert int(contract.epoch_total_tickets.value) == 2


# ---------------------------------------------------------------------------
# TestResolveDraw
# ---------------------------------------------------------------------------

class TestResolveDraw:
    def test_resolve_without_pending_reverts(self) -> None:
        """A stale resolve must fail with a clean assert, not a division-by-zero.

        Kill-the-mutant: remove the pending != 0 assert."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            with pytest.raises(AssertionError, match="no pending draw"):
                contract.resolve_draw(
                    algopy.arc4.DynamicArray[algopy.arc4.UInt64](
                        *[algopy.arc4.UInt64(0)] * 6
                    )
                )

    def test_resolve_before_settle_buffer_reverts(self) -> None:
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            _commit(ctx, contract)
            ctx.ledger.patch_global_fields(
                round=int(contract.pending_commit_round.value) + BEACON_SETTLE_BUFFER - 1
            )
            with pytest.raises(AssertionError, match="VRF round not yet settled"):
                contract.resolve_draw(
                    algopy.arc4.DynamicArray[algopy.arc4.UInt64](
                        *[algopy.arc4.UInt64(0)] * 6
                    )
                )

    def test_resolve_wrong_hint_count_reverts(self) -> None:
        """Kill-the-mutant: remove the hints.length assert."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            _commit(ctx, contract)
            ctx.ledger.patch_global_fields(
                round=int(contract.pending_commit_round.value) + BEACON_SETTLE_BUFFER
            )
            with pytest.raises(AssertionError, match="hints length mismatch"):
                contract.resolve_draw(
                    algopy.arc4.DynamicArray[algopy.arc4.UInt64](
                        *[algopy.arc4.UInt64(0)] * 3
                    )
                )

    def test_single_player_sweeps_all_slots(self, monkeypatch) -> None:
        """One player owns every ticket: hint 0 verifies for all 6 slots (the
        hint==0 underflow blocker), payouts = 70% + 5x4%, 10% rolls over.

        Kill-the-mutant: remove the hint==0 branch in resolve_draw() -- the
        lower-bound read underflows and this test fails."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, 4 * TICKET_UNIT, cut=10_000_000)
            _commit(ctx, contract)
            _patch_beacon(monkeypatch, hashlib.sha256(b"any").digest())
            _resolve(ctx, contract, [0] * 6)

            pot = 10_000_000
            expected_winner = pot * DEFAULT_WINNER_BPS // BPS_DENOMINATOR
            expected_runner = pot * DEFAULT_RUNNER_BPS // BPS_DENOMINATOR
            pays = _inner_payments(ctx)
            assert len(pays) == 6
            assert int(pays[0].amount) == expected_winner
            assert all(int(p.amount) == expected_runner for p in pays[1:])
            assert all(str(p.receiver) == player for p in pays)

            rollover = pot - expected_winner - 5 * expected_runner
            assert rollover == pot // 10
            assert int(contract.pot_balance.value) == rollover
            assert int(contract.last_rollover.value) == rollover
            assert int(contract.pending_epoch.value) == 0

    def test_two_players_winner_by_ticket_range(self, monkeypatch) -> None:
        """Slot-0 winner is the entry whose range contains the VRF ticket; the
        correct hint passes, the WRONG hint reverts.

        Kill-the-mutant: loosen either range assert in resolve_draw()."""
        admin = _gen_addr()
        p1, p2 = _gen_addr(), _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, p1, 3 * TICKET_UNIT, cut=1_000_000)  # tickets 0-2 (entry 0)
            _accrue(ctx, contract, p2, 7 * TICKET_UNIT, cut=1_000_000)  # tickets 3-9 (entry 1)
            _commit(ctx, contract)

            beacon = _beacon_for_winner_ticket(total=10, want_ticket_for_slot0=5)  # p2's range
            _patch_beacon(monkeypatch, beacon)
            correct_hints = [1] + [
                0 if _slot_ticket(beacon, s, 10) < 3 else 1 for s in range(1, 6)
            ]
            _resolve(ctx, contract, correct_hints)
            pays = _inner_payments(ctx)
            assert str(pays[0].receiver) == p2
            assert int(pays[0].amount) == 2_000_000 * DEFAULT_WINNER_BPS // BPS_DENOMINATOR

    def test_wrong_hint_reverts(self, monkeypatch) -> None:
        admin = _gen_addr()
        p1, p2 = _gen_addr(), _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, p1, 3 * TICKET_UNIT, cut=1_000_000)
            _accrue(ctx, contract, p2, 7 * TICKET_UNIT, cut=1_000_000)
            _commit(ctx, contract)
            beacon = _beacon_for_winner_ticket(total=10, want_ticket_for_slot0=5)
            _patch_beacon(monkeypatch, beacon)
            # slot 0's ticket is 5 (p2, entry 1) -- pointing the hint at entry 0 must die
            with pytest.raises(AssertionError, match="ticket above hint range"):
                _resolve(ctx, contract, [0] * 6)

    def test_hint_out_of_range_reverts(self, monkeypatch) -> None:
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT, cut=1_000_000)
            _commit(ctx, contract)
            _patch_beacon(monkeypatch, hashlib.sha256(b"x").digest())
            with pytest.raises(AssertionError, match="hint out of range"):
                _resolve(ctx, contract, [1] * 6)

    def test_excluded_winner_slot_rolls_over(self, monkeypatch) -> None:
        """A wallet excluded AFTER accruing still cannot be paid: its slot's payout
        joins the rollover, recorded with payout 0.

        Kill-the-mutant: remove the exclusion re-check in resolve_draw()."""
        admin = _gen_addr()
        house = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, house, 4 * TICKET_UNIT, cut=10_000_000)
            _commit(ctx, contract)
            contract.set_excluded(algopy.arc4.UInt64(1), algopy.arc4.Address(house))
            _patch_beacon(monkeypatch, hashlib.sha256(b"any").digest())
            _resolve(ctx, contract, [0] * 6)
            assert len(_inner_payments(ctx)) == 0  # every slot excluded
            assert int(contract.pot_balance.value) == 10_000_000  # full pot rolls
            assert int(contract.last_rollover.value) == 10_000_000

    def test_set_params_after_commit_does_not_affect_draw(self, monkeypatch) -> None:
        """Admin param change between commit and resolve must not alter the
        committed split (provably-fair requirement).

        Kill-the-mutant: make resolve_draw() read live winner_bps instead of
        pending_winner_bps."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, 4 * TICKET_UNIT, cut=10_000_000)
            _commit(ctx, contract)
            contract.set_params(
                winner_bps=algopy.arc4.UInt64(100),
                runner_bps=algopy.arc4.UInt64(10),
                runner_count=algopy.arc4.UInt64(1),
                backstop_microalgo=algopy.arc4.UInt64(0),
            )
            _patch_beacon(monkeypatch, hashlib.sha256(b"any").digest())
            _resolve(ctx, contract, [0] * 6)  # still 6 slots: snapshot, not live params
            pays = _inner_payments(ctx)
            assert int(pays[0].amount) == 10_000_000 * DEFAULT_WINNER_BPS // BPS_DENOMINATOR

    def test_resolve_paused_reverts(self, monkeypatch) -> None:
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            _commit(ctx, contract)
            contract.set_paused(algopy.arc4.Bool(True))
            _patch_beacon(monkeypatch, hashlib.sha256(b"x").digest())
            with pytest.raises(AssertionError, match="contract is paused"):
                _resolve(ctx, contract, [0] * 6)


# ---------------------------------------------------------------------------
# TestRecommit
# ---------------------------------------------------------------------------

class TestRecommit:
    def test_recommit_without_pending_reverts(self) -> None:
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            with pytest.raises(AssertionError, match="no pending draw"):
                contract.recommit_draw()

    def test_recommit_before_expiry_reverts(self) -> None:
        """A live draw cannot be re-rolled by racing the resolver.

        Kill-the-mutant: remove the RECOMMIT_AFTER_ROUNDS gate."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            _commit(ctx, contract)
            ctx.ledger.patch_global_fields(
                round=int(contract.pending_commit_round.value) + RECOMMIT_AFTER_ROUNDS
            )
            with pytest.raises(AssertionError, match="draw is still resolvable"):
                contract.recommit_draw()

    def test_recommit_after_expiry_retargets(self) -> None:
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            _commit(ctx, contract)
            old_round = int(contract.pending_commit_round.value)
            ctx.ledger.patch_global_fields(round=old_round + RECOMMIT_AFTER_ROUNDS + 1)
            contract.recommit_draw()
            new_round = int(contract.pending_commit_round.value)
            assert new_round > old_round + RECOMMIT_AFTER_ROUNDS
            assert new_round % 8 == 0
            assert int(contract.pending_epoch.value) == 1  # same epoch, fresh round


# ---------------------------------------------------------------------------
# TestCleanup
# ---------------------------------------------------------------------------

class TestCleanup:
    def test_cleanup_current_epoch_reverts(self) -> None:
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            with pytest.raises(AssertionError, match="epoch still accruing"):
                contract.cleanup(
                    epoch=algopy.arc4.UInt64(1),
                    players=algopy.arc4.DynamicArray[algopy.arc4.Address](
                        algopy.arc4.Address(player)
                    ),
                    pages=algopy.arc4.DynamicArray[algopy.arc4.UInt64](algopy.arc4.UInt64(0)),
                )

    def test_cleanup_pending_epoch_reverts(self) -> None:
        """The drawn epoch's ledger must survive until resolve_draw verified it.

        Kill-the-mutant: remove the pending_epoch != e assert."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT)
            _commit(ctx, contract)
            with pytest.raises(AssertionError, match="epoch draw still pending"):
                contract.cleanup(
                    epoch=algopy.arc4.UInt64(1),
                    players=algopy.arc4.DynamicArray[algopy.arc4.Address](
                        algopy.arc4.Address(player)
                    ),
                    pages=algopy.arc4.DynamicArray[algopy.arc4.UInt64](algopy.arc4.UInt64(0)),
                )

    def test_cleanup_resolved_epoch_deletes_boxes(self, monkeypatch) -> None:
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            _accrue(ctx, contract, player, TICKET_UNIT, cut=1_000_000)
            _commit(ctx, contract)
            _patch_beacon(monkeypatch, hashlib.sha256(b"any").digest())
            _resolve(ctx, contract, [0] * 6)
            assert _tickets(contract, 1, player) == 1
            contract.cleanup(
                epoch=algopy.arc4.UInt64(1),
                players=algopy.arc4.DynamicArray[algopy.arc4.Address](
                    algopy.arc4.Address(player)
                ),
                pages=algopy.arc4.DynamicArray[algopy.arc4.UInt64](algopy.arc4.UInt64(0)),
            )
            assert _tickets(contract, 1, player) == 0


# ---------------------------------------------------------------------------
# TestAdmin
# ---------------------------------------------------------------------------

class TestAdmin:
    def test_set_params_validations(self) -> None:
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            with pytest.raises(AssertionError, match="runner_count must be at least 1"):
                contract.set_params(
                    winner_bps=algopy.arc4.UInt64(7000),
                    runner_bps=algopy.arc4.UInt64(400),
                    runner_count=algopy.arc4.UInt64(0),
                    backstop_microalgo=algopy.arc4.UInt64(0),
                )
            with pytest.raises(AssertionError, match="runner_count too large"):
                contract.set_params(
                    winner_bps=algopy.arc4.UInt64(7000),
                    runner_bps=algopy.arc4.UInt64(400),
                    runner_count=algopy.arc4.UInt64(6),
                    backstop_microalgo=algopy.arc4.UInt64(0),
                )
            with pytest.raises(AssertionError, match="split exceeds 100%"):
                contract.set_params(
                    winner_bps=algopy.arc4.UInt64(9000),
                    runner_bps=algopy.arc4.UInt64(400),
                    runner_count=algopy.arc4.UInt64(5),
                    backstop_microalgo=algopy.arc4.UInt64(0),
                )

    def test_set_params_applies(self) -> None:
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            contract.set_params(
                winner_bps=algopy.arc4.UInt64(8000),
                runner_bps=algopy.arc4.UInt64(200),
                runner_count=algopy.arc4.UInt64(3),
                backstop_microalgo=algopy.arc4.UInt64(50_000_000),
            )
            assert int(contract.winner_bps.value) == 8000
            assert int(contract.runner_bps.value) == 200
            assert int(contract.runner_count.value) == 3
            assert int(contract.backstop_microalgo.value) == 50_000_000

    def test_non_admin_rejected_everywhere(self) -> None:
        admin = _gen_addr()
        outsider = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            with ctx.txn.create_group(
                active_txn_overrides={"sender": algopy.Account(outsider)}
            ):
                with pytest.raises(AssertionError, match="sender is not admin"):
                    contract.set_paused(algopy.arc4.Bool(True))

    def test_invalid_slots_revert(self) -> None:
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            with pytest.raises(AssertionError, match="invalid game slot"):
                contract.set_game(algopy.arc4.UInt64(5), algopy.arc4.UInt64(0))
            with pytest.raises(AssertionError, match="invalid exclusion slot"):
                contract.set_excluded(
                    algopy.arc4.UInt64(9), algopy.arc4.Address(_gen_addr())
                )

    def test_set_beacon_requires_pause_and_no_pending(self) -> None:
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            ctx.any.application(id=4999)
            with pytest.raises(AssertionError, match="must pause before changing beacon"):
                contract.set_beacon_app_id(algopy.arc4.UInt64(4999))
            contract.set_paused(algopy.arc4.Bool(True))
            contract.set_beacon_app_id(algopy.arc4.UInt64(4999))
            assert int(contract.beacon_app_id.value) == 4999

    def test_set_admin_transfers_rights(self) -> None:
        admin = _gen_addr()
        new_admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            contract.set_admin(algopy.arc4.Address(new_admin))
            assert str(contract.admin.value) == new_admin
            with pytest.raises(AssertionError, match="sender is not admin"):
                contract.set_paused(algopy.arc4.Bool(True))


# ---------------------------------------------------------------------------
# TestMultiPage
# ---------------------------------------------------------------------------

class TestMultiPage:
    def test_entries_roll_to_second_page_and_resolve_across_pages(self, monkeypatch) -> None:
        """Fill page 0 (102 entries), spill onto page 1, then resolve with a winner
        whose lower bound lives on the PREVIOUS page (the cross-page read).

        Kill-the-mutant: break the page/offset arithmetic in _entry_cum."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_pot(ctx, admin)
            players = [_gen_addr() for _ in range(ENTRIES_PER_PAGE + 2)]
            for p in players:
                _accrue(ctx, contract, p, TICKET_UNIT, cut=10_000)
            total = ENTRIES_PER_PAGE + 2
            assert int(contract.epoch_entry_count.value) == total
            # entry 102 sits on page 1; its cum must continue page 0's sequence
            assert _entry(ctx, contract, 1, ENTRIES_PER_PAGE) == (
                players[ENTRIES_PER_PAGE],
                ENTRIES_PER_PAGE + 1,
            )

            _commit(ctx, contract)
            # force the slot-0 winner onto entry 102 (first entry of page 1):
            # its ticket index == 102 (0-based), lower bound = cum of entry 101 (page 0)
            beacon = _beacon_for_winner_ticket(total=total, want_ticket_for_slot0=ENTRIES_PER_PAGE)
            _patch_beacon(monkeypatch, beacon)
            hints = [ENTRIES_PER_PAGE] + [_slot_ticket(beacon, s, total) for s in range(1, 6)]
            _resolve(ctx, contract, hints)
            pays = _inner_payments(ctx)
            assert str(pays[0].receiver) == players[ENTRIES_PER_PAGE]
