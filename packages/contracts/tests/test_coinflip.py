"""
Tests for CoinflipContract.

Kill-the-mutant check: before committing, comment out a key assertion in the SUT
(e.g., the idempotency guard `del self.flips[player]` at the end of resolve(),
or the `elapsed >= REFUND_WINDOW_ROUNDS` check in refund()) and confirm that at
least one test here fails. Re-add before pushing.

Uses algorand-python-testing==1.1.0 offline context (no LocalNet required).
"""

from __future__ import annotations

import typing

import pytest
import algosdk
import algosdk.logic
from algopy_testing import algopy_testing_context
import algopy
from _algopy_testing.primitives import UInt64
from _algopy_testing.itxn import ApplicationCallInnerTransaction, PaymentInnerTransaction

from smart_contracts.coinflip.contract import (
    CoinflipContract,
    BEACON_DELAY,
    BEACON_SETTLE_BUFFER,
    BEACON_TIMELOCK_ROUNDS,
    BOX_MBR,
    REFUND_WINDOW_ROUNDS,
    BPS_DENOMINATOR,
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

TREASURY_APP_ID = 2001
BEACON_APP_ID = 2002
JACKPOT_APP_ID = 2003
MIN_BET = 500_000   # 0.5 ALGO
MAX_BET = 500_000   # 0.5 ALGO (v1 hard cap)
# v2 economics are create() args stored in global state (not module constants):
HOUSE_EDGE_BPS = 500
REFERRAL_BPS = 100
JACKPOT_BPS = 150
SAMPLE_SALT = bytes(range(32))
# sha256(beacon_output + SAMPLE_SALT)[0] % 2: 1 = win, 0 = loss (verified offline).
WIN_BYTES = bytes([0] * 32)
LOSS_BYTES = bytes([2] * 32)


def _ceil8_commit(start_round: int) -> int:
    """Mirror the contract: next beacon-aligned round >= start + BEACON_DELAY."""
    return ((start_round + BEACON_DELAY + 7) // 8) * 8


def _gen_addr() -> str:
    _, addr = algosdk.account.generate_account()
    return addr


def _make_salt() -> algopy.arc4.StaticArray[algopy.arc4.Byte, typing.Literal[32]]:
    return algopy.arc4.StaticArray[algopy.arc4.Byte, typing.Literal[32]](
        *[algopy.arc4.Byte(b) for b in SAMPLE_SALT]
    )


def _deploy_coinflip(
    ctx,
    admin: str,
    min_bet: int = MIN_BET,
    max_bet: int = MAX_BET,
    house_edge_bps: int = HOUSE_EDGE_BPS,
    referral_bps: int = REFERRAL_BPS,
    jackpot_app_id: int = 0,
    jackpot_bps: int = JACKPOT_BPS,
) -> CoinflipContract:
    """Deploy a fresh CoinflipContract. jackpot_app_id=0 skips the pot stream
    entirely, keeping the pre-pot tests untouched."""
    ctx.any.application(id=TREASURY_APP_ID)
    ctx.any.application(id=BEACON_APP_ID)
    if jackpot_app_id:
        ctx.any.application(id=jackpot_app_id)
    contract = CoinflipContract()
    contract.create(
        admin=algopy.arc4.Address(admin),
        treasury_app_id=algopy.arc4.UInt64(TREASURY_APP_ID),
        beacon_app_id=algopy.arc4.UInt64(BEACON_APP_ID),
        min_bet=algopy.arc4.UInt64(min_bet),
        max_bet=algopy.arc4.UInt64(max_bet),
        house_edge_bps=algopy.arc4.UInt64(house_edge_bps),
        referral_bps=algopy.arc4.UInt64(referral_bps),
        jackpot_app_id=algopy.arc4.UInt64(jackpot_app_id),
        jackpot_bps=algopy.arc4.UInt64(jackpot_bps),
    )
    return contract


def _coinflip_addr(contract: CoinflipContract) -> str:
    return algosdk.logic.get_application_address(contract.__app_id__)


def _fund_coinflip(ctx, contract: CoinflipContract, balance: int = 10_000_000_000) -> None:
    ctx.ledger.update_account(
        _coinflip_addr(contract),
        balance=UInt64(balance),
        min_balance=UInt64(100_000),
    )


def _do_flip(
    ctx,
    contract: CoinflipContract,
    player: str,
    referrer: str | None = None,
    bet: int = MIN_BET,
) -> int:
    """Execute a flip() and return the committed VRF round (int)."""
    coinflip_addr = _coinflip_addr(contract)
    ref_addr = referrer or "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
    pay = ctx.any.txn.payment(
        sender=algopy.Account(player),
        receiver=algopy.Account(coinflip_addr),
        amount=UInt64(bet + BOX_MBR),
    )
    with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
        result = contract.flip(
            pay=pay,
            salt_hash=_make_salt(),
            referrer=algopy.arc4.Address(ref_addr),
        )
    return result.native


# ---------------------------------------------------------------------------
# TestCreate
# ---------------------------------------------------------------------------

class TestCreate:
    def test_initial_state_matches_args(self) -> None:
        """After create(), all global state fields match constructor args.

        Kill-the-mutant: comment out one GlobalState assignment in create() and
        confirm this test catches the missing field.
        """
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            assert str(contract.admin.value) == admin
            assert int(contract.treasury_app_id.value) == TREASURY_APP_ID
            assert int(contract.beacon_app_id.value) == BEACON_APP_ID
            assert int(contract.min_bet.value) == MIN_BET
            assert int(contract.max_bet.value) == MAX_BET
            assert int(contract.paused.value) == 0
            assert int(contract.total_bets.value) == 0
            assert int(contract.total_volume.value) == 0
            # v2: economics live in global state -- readable on-chain (spec hard req)
            assert int(contract.house_edge_bps.value) == HOUSE_EDGE_BPS
            assert int(contract.referral_bps.value) == REFERRAL_BPS
            assert int(contract.jackpot_bps.value) == JACKPOT_BPS
            assert int(contract.jackpot_app_id.value) == 0


# ---------------------------------------------------------------------------
# TestFlip
# ---------------------------------------------------------------------------

class TestFlip:
    def test_flip_payment_too_small(self) -> None:
        """flip reverts when payment <= BOX_MBR (no bet amount left).

        Kill-the-mutant: remove the `pay.amount > BOX_MBR` check and confirm
        this test fails.
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            coinflip_addr = _coinflip_addr(contract)
            pay = ctx.any.txn.payment(
                sender=algopy.Account(player),
                receiver=algopy.Account(coinflip_addr),
                amount=UInt64(BOX_MBR),   # exactly BOX_MBR, no bet
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match="payment too small"):
                    contract.flip(
                        pay=pay,
                        salt_hash=_make_salt(),
                        referrer=algopy.arc4.Address(
                            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
                        ),
                    )

    @pytest.mark.parametrize(
        "bet_amount,error_fragment",
        [
            (MIN_BET - 1, "bet below minimum"),
            (MAX_BET + 1, "bet above maximum"),
        ],
    )
    def test_flip_rejects_out_of_range_bet(
        self, bet_amount: int, error_fragment: str
    ) -> None:
        """flip rejects bet below min_bet and bet above max_bet.

        Kill-the-mutant: remove one of the min/max assertions and confirm
        the corresponding parametrized case fails.
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin, min_bet=MIN_BET, max_bet=MAX_BET)
            coinflip_addr = _coinflip_addr(contract)
            pay = ctx.any.txn.payment(
                sender=algopy.Account(player),
                receiver=algopy.Account(coinflip_addr),
                amount=UInt64(bet_amount + BOX_MBR),
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match=error_fragment):
                    contract.flip(
                        pay=pay,
                        salt_hash=_make_salt(),
                        referrer=algopy.arc4.Address(
                            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
                        ),
                    )

    def test_flip_rejects_self_referral(self) -> None:
        """flip reverts when referrer == Txn.sender.

        Kill-the-mutant: remove the self-referral check and confirm this test fails.
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            coinflip_addr = _coinflip_addr(contract)
            pay = ctx.any.txn.payment(
                sender=algopy.Account(player),
                receiver=algopy.Account(coinflip_addr),
                amount=UInt64(MIN_BET + BOX_MBR),
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match="referrer cannot be the player"):
                    contract.flip(
                        pay=pay,
                        salt_hash=_make_salt(),
                        referrer=algopy.arc4.Address(player),  # self-referral
                    )

    def test_flip_rejects_second_active_flip(self) -> None:
        """A second flip() from the same player while first is unresolved must revert.

        Kill-the-mutant: remove the `assert player not in self.flips` check and
        confirm this test fails.
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            _do_flip(ctx, contract, player)
            # Second flip from same player
            coinflip_addr = _coinflip_addr(contract)
            pay2 = ctx.any.txn.payment(
                sender=algopy.Account(player),
                receiver=algopy.Account(coinflip_addr),
                amount=UInt64(MIN_BET + BOX_MBR),
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match="player already has an active flip"):
                    contract.flip(
                        pay=pay2,
                        salt_hash=_make_salt(),
                        referrer=algopy.arc4.Address(
                            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
                        ),
                    )

    def test_flip_stores_state_and_commits_correct_round(self) -> None:
        """flip() stores FlipState box with correct vrf_round = current_round + BEACON_DELAY."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            start_round = int(algopy.Global.round)
            commit_round = _do_flip(ctx, contract, player)

            assert commit_round == _ceil8_commit(start_round)
            assert commit_round % 8 == 0
            assert contract.has_active_flip(algopy.arc4.Address(player)).native is True
            assert int(contract.total_bets.value) == 1
            assert int(contract.total_volume.value) == MIN_BET

            state = contract.get_flip_state(algopy.arc4.Address(player))
            assert state.bet_amount.native == MIN_BET
            assert state.vrf_round.native == commit_round

    def test_flip_increments_total_bets_and_volume(self) -> None:
        """flip() increments total_bets and total_volume correctly."""
        admin = _gen_addr()
        player1 = _gen_addr()
        player2 = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            _do_flip(ctx, contract, player1)
            _do_flip(ctx, contract, player2)
            assert int(contract.total_bets.value) == 2
            assert int(contract.total_volume.value) == 2 * MIN_BET


# ---------------------------------------------------------------------------
# TestResolve
# ---------------------------------------------------------------------------

class TestResolve:
    def test_resolve_reverts_when_no_box(self) -> None:
        """resolve() reverts when the player has no active flip box.

        The assert (not a silent False) makes a duplicate / already-resolved resolve
        REVERT, so the keeper never mistakes it for a real loss.
        Kill-the-mutant: change `assert player in self.flips` back to a False return and
        confirm this test fails (it would return False instead of raising).
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            with pytest.raises(Exception):
                contract.resolve(algopy.arc4.Address(player))

    def test_resolve_reverts_before_beacon_round(self) -> None:
        """resolve() must revert if called before commit_round + BEACON_SETTLE_BUFFER.

        Kill-the-mutant: reduce BEACON_SETTLE_BUFFER to 0 and confirm this test fails.
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            commit_round = _do_flip(ctx, contract, player)
            # Stay at commit_round + BEACON_SETTLE_BUFFER - 1 (not yet settled)
            ctx.ledger.patch_global_fields(
                round=commit_round + BEACON_SETTLE_BUFFER - 1
            )
            with pytest.raises(AssertionError, match="VRF round not yet settled"):
                contract.resolve(algopy.arc4.Address(player))


# ---------------------------------------------------------------------------
# TestRefund
# ---------------------------------------------------------------------------

class TestRefund:
    def test_refund_reverts_before_window(self) -> None:
        """refund() reverts when elapsed rounds < REFUND_WINDOW_ROUNDS.

        Kill-the-mutant: remove the elapsed >= REFUND_WINDOW_ROUNDS check and
        confirm this test fails.
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player)

            # Advance to just before the refund window opens
            ctx.ledger.patch_global_fields(
                round=commit_round + REFUND_WINDOW_ROUNDS - 1
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match="48h refund window has not elapsed"):
                    contract.refund()

    def test_refund_succeeds_after_window(self) -> None:
        """refund() succeeds after REFUND_WINDOW_ROUNDS and deletes the box.

        Kill-the-mutant: remove `del self.flips[player]` from refund() and confirm
        this test fails (has_active_flip would still return True).
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player)

            ctx.ledger.patch_global_fields(
                round=commit_round + REFUND_WINDOW_ROUNDS
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                contract.refund()

            assert contract.has_active_flip(algopy.arc4.Address(player)).native is False

    def test_refund_pays_bet_plus_mbr_directly(self) -> None:
        """refund() pays bet + BOX_MBR via a direct Payment (no app call to treasury).

        This is the treasury-independence invariant: refund works even when the
        treasury is paused. Kill-the-mutant: change the refund payout amount and
        confirm this test detects the discrepancy.
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player)

            ctx.ledger.patch_global_fields(
                round=commit_round + REFUND_WINDOW_ROUNDS
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                contract.refund()

            last_group = ctx.txn.last_group

            # Exactly one inner Payment, zero inner ApplicationCalls
            all_inner = [t for group in last_group.itxn_groups for t in group]
            pay_itxns = [t for t in all_inner if isinstance(t, PaymentInnerTransaction)]
            app_itxns = [t for t in all_inner if isinstance(t, ApplicationCallInnerTransaction)]

            assert len(pay_itxns) == 1, "expected exactly one inner Payment"
            assert len(app_itxns) == 0, "refund must NOT call the treasury"

            # Amount = bet + MBR
            assert int(pay_itxns[0].amount) == MIN_BET + BOX_MBR
            # Receiver = the player
            assert str(pay_itxns[0].receiver) == player

    def test_refund_reverts_with_no_active_flip(self) -> None:
        """refund() reverts when the sender has no active flip box."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match="no active flip for this address"):
                    contract.refund()

    def test_refund_only_callable_by_flip_owner(self) -> None:
        """refund() from a different player reverts (box key is the player's address).

        Unlike resolve(), refund() is NOT permissionless: Txn.sender must match
        the box key. A different sender simply has no flip box.
        """
        admin = _gen_addr()
        player = _gen_addr()
        other = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player)

            ctx.ledger.patch_global_fields(
                round=commit_round + REFUND_WINDOW_ROUNDS
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(other)}):
                with pytest.raises(AssertionError, match="no active flip for this address"):
                    contract.refund()

    @pytest.mark.parametrize(
        "rounds_elapsed,should_pass",
        [
            (REFUND_WINDOW_ROUNDS - 1, False),   # one round too early
            (REFUND_WINDOW_ROUNDS, True),         # exactly at the boundary
            (REFUND_WINDOW_ROUNDS + 1000, True),  # well past the window
        ],
    )
    def test_refund_window_boundary_parametrized(
        self, rounds_elapsed: int, should_pass: bool
    ) -> None:
        """Parametrized: verify the refund window boundary is enforced correctly.

        Kill-the-mutant: use `> REFUND_WINDOW_ROUNDS` instead of `>=` in the SUT
        and confirm the `rounds_elapsed == REFUND_WINDOW_ROUNDS` case fails.
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player)

            ctx.ledger.patch_global_fields(round=commit_round + rounds_elapsed)
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                if should_pass:
                    contract.refund()
                    assert (
                        contract.has_active_flip(algopy.arc4.Address(player)).native is False
                    )
                else:
                    with pytest.raises(AssertionError, match="48h refund window has not elapsed"):
                        contract.refund()


# ---------------------------------------------------------------------------
# TestAdmin
# ---------------------------------------------------------------------------

class TestAdmin:
    def test_non_admin_cannot_pause(self) -> None:
        """set_paused() reverts for non-admin."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match="sender is not admin"):
                    contract.set_paused(algopy.arc4.Bool(True))

    def test_admin_can_pause_and_unpause(self) -> None:
        """Admin can toggle pause; paused state reflects correctly."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            contract.set_paused(algopy.arc4.Bool(True))
            assert int(contract.paused.value) == 1
            contract.set_paused(algopy.arc4.Bool(False))
            assert int(contract.paused.value) == 0

    def test_flip_reverts_when_paused(self) -> None:
        """flip() reverts when paused == 1."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            contract.set_paused(algopy.arc4.Bool(True))
            coinflip_addr = _coinflip_addr(contract)
            pay = ctx.any.txn.payment(
                sender=algopy.Account(player),
                receiver=algopy.Account(coinflip_addr),
                amount=UInt64(MIN_BET + BOX_MBR),
            )
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match="contract is paused"):
                    contract.flip(
                        pay=pay,
                        salt_hash=_make_salt(),
                        referrer=algopy.arc4.Address(
                            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
                        ),
                    )

    def test_set_min_bet_rejects_above_max(self) -> None:
        """set_min_bet() reverts when new min_bet > max_bet."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin, min_bet=MIN_BET, max_bet=MAX_BET)
            with pytest.raises(AssertionError, match="min_bet cannot exceed max_bet"):
                contract.set_min_bet(algopy.arc4.UInt64(MAX_BET + 1))

    def test_set_max_bet_rejects_below_min(self) -> None:
        """set_max_bet() reverts when new max_bet < min_bet."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin, min_bet=MIN_BET, max_bet=MAX_BET)
            with pytest.raises(AssertionError, match="max_bet cannot be less than min_bet"):
                contract.set_max_bet(algopy.arc4.UInt64(MIN_BET - 1))

    def test_beacon_change_blocked_before_timelock(self) -> None:
        """apply_beacon_change() reverts before BEACON_TIMELOCK_ROUNDS elapse.
        The beacon decides every outcome -- an instant swap is a drain vector.

        Kill-the-mutant: remove the timelock assert in apply_beacon_change()."""
        admin = _gen_addr()
        NEW_BEACON = 3999
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            ctx.any.application(id=NEW_BEACON)
            contract.request_beacon_change(algopy.arc4.UInt64(NEW_BEACON))
            start = int(contract.pending_beacon_round.value)
            ctx.ledger.patch_global_fields(round=start + BEACON_TIMELOCK_ROUNDS - 1)
            with pytest.raises(AssertionError, match="beacon timelock has not elapsed"):
                contract.apply_beacon_change()
            assert int(contract.beacon_app_id.value) == BEACON_APP_ID

    def test_beacon_change_applies_after_timelock(self) -> None:
        """request + wait BEACON_TIMELOCK_ROUNDS -> apply swaps the beacon and
        clears the pending request."""
        admin = _gen_addr()
        NEW_BEACON = 3999
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            ctx.any.application(id=NEW_BEACON)
            contract.request_beacon_change(algopy.arc4.UInt64(NEW_BEACON))
            start = int(contract.pending_beacon_round.value)
            ctx.ledger.patch_global_fields(round=start + BEACON_TIMELOCK_ROUNDS)
            contract.apply_beacon_change()
            assert int(contract.beacon_app_id.value) == NEW_BEACON
            assert int(contract.pending_beacon_round.value) == 0
            assert int(contract.pending_beacon_app_id.value) == 0

    def test_apply_beacon_change_without_request_reverts(self) -> None:
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            with pytest.raises(AssertionError, match="no beacon change requested"):
                contract.apply_beacon_change()

    def test_non_admin_cannot_request_beacon_change(self) -> None:
        admin = _gen_addr()
        outsider = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(outsider)}):
                with pytest.raises(AssertionError, match="sender is not admin"):
                    contract.request_beacon_change(algopy.arc4.UInt64(3999))

    def test_set_admin_transfers_rights(self) -> None:
        """set_admin() hands over control; the old admin loses it. (Audit H-6.)

        Kill-the-mutant: make set_admin() a no-op and the second half fails."""
        admin = _gen_addr()
        new_admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            contract.set_admin(algopy.arc4.Address(new_admin))
            assert str(contract.admin.value) == new_admin
            with pytest.raises(AssertionError, match="sender is not admin"):
                contract.set_paused(algopy.arc4.Bool(True))

    def test_non_admin_cannot_set_admin(self) -> None:
        admin = _gen_addr()
        outsider = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(outsider)}):
                with pytest.raises(AssertionError, match="sender is not admin"):
                    contract.set_admin(algopy.arc4.Address(outsider))


# ---------------------------------------------------------------------------
# TestCreateValidation (v2 economics args)
# ---------------------------------------------------------------------------

class TestCreateValidation:
    @pytest.mark.parametrize(
        "edge,referral,jackpot,error_fragment",
        [
            (0, 100, 150, "house_edge_bps must be positive"),
            (1001, 100, 150, "house_edge_bps exceeds 10%"),
            (300, 200, 150, "referral \\+ jackpot cannot exceed the house edge"),
        ],
    )
    def test_create_rejects_bad_economics(
        self, edge: int, referral: int, jackpot: int, error_fragment: str
    ) -> None:
        """create() validates the split invariants.

        Kill-the-mutant: remove any of the three create() economics asserts and
        the corresponding case fails."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            ctx.any.application(id=TREASURY_APP_ID)
            ctx.any.application(id=BEACON_APP_ID)
            contract = CoinflipContract()
            with pytest.raises(AssertionError, match=error_fragment):
                contract.create(
                    admin=algopy.arc4.Address(admin),
                    treasury_app_id=algopy.arc4.UInt64(TREASURY_APP_ID),
                    beacon_app_id=algopy.arc4.UInt64(BEACON_APP_ID),
                    min_bet=algopy.arc4.UInt64(MIN_BET),
                    max_bet=algopy.arc4.UInt64(MAX_BET),
                    house_edge_bps=algopy.arc4.UInt64(edge),
                    referral_bps=algopy.arc4.UInt64(referral),
                    jackpot_app_id=algopy.arc4.UInt64(0),
                    jackpot_bps=algopy.arc4.UInt64(jackpot),
                )

    def test_create_resolves_jackpot_app_address(self) -> None:
        """With a jackpot app id, create() caches the pot's application address."""
        admin = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin, jackpot_app_id=JACKPOT_APP_ID)
            assert int(contract.jackpot_app_id.value) == JACKPOT_APP_ID
            assert str(contract.jackpot_app_addr.value) == algosdk.logic.get_application_address(
                JACKPOT_APP_ID
            )


# ---------------------------------------------------------------------------
# TestResolveHappyPath (via the _read_beacon/_pay_winner/_accrue_to_jackpot seams)
# ---------------------------------------------------------------------------

def _settle_round(ctx, commit_round: int) -> None:
    ctx.ledger.patch_global_fields(round=commit_round + BEACON_SETTLE_BUFFER)


class TestResolveHappyPath:
    def test_resolve_loss_pays_jackpot_cut_and_sweep(self, monkeypatch) -> None:
        """Loss with referrer + pot: inner payments are exactly referral (1%),
        jackpot cut (1.5%) to the pot address, sweep (bet - both) to treasury,
        and the BOX_MBR return; accrue() is called with (player, bet, cut).

        Kill-the-mutant: change the jackpot_cut formula or the sweep subtraction
        in resolve() and this test fails."""
        admin = _gen_addr()
        player = _gen_addr()
        referrer = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin, jackpot_app_id=JACKPOT_APP_ID)
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player, referrer=referrer)
            _settle_round(ctx, commit_round)

            accrue_calls: list[tuple[str, int, int]] = []
            monkeypatch.setattr(
                CoinflipContract,
                "_accrue_to_jackpot",
                lambda self, p, b, c: accrue_calls.append((str(p), int(b), int(c))),
            )
            monkeypatch.setattr(
                CoinflipContract, "_read_beacon", lambda self, r: algopy.Bytes(LOSS_BYTES)
            )
            paid: list[tuple[str, int]] = []
            monkeypatch.setattr(
                CoinflipContract, "_pay_winner", lambda self, p, n: paid.append((str(p), int(n)))
            )

            result = contract.resolve(algopy.arc4.Address(player))
            assert result.native is False
            assert paid == []

            referral = MIN_BET * REFERRAL_BPS // BPS_DENOMINATOR
            cut = MIN_BET * JACKPOT_BPS // BPS_DENOMINATOR
            assert accrue_calls == [(player, MIN_BET, cut)]

            all_inner = [t for g in ctx.txn.last_group.itxn_groups for t in g]
            pays = [t for t in all_inner if isinstance(t, PaymentInnerTransaction)]
            by_amount = {int(p.amount): str(p.receiver) for p in pays}
            assert by_amount[referral] == referrer
            assert by_amount[cut] == algosdk.logic.get_application_address(JACKPOT_APP_ID)
            assert by_amount[MIN_BET - referral - cut] == algosdk.logic.get_application_address(
                TREASURY_APP_ID
            )
            assert by_amount[BOX_MBR] == player
            assert len(pays) == 4
            assert contract.has_active_flip(algopy.arc4.Address(player)).native is False

    def test_resolve_win_pays_1_90x(self, monkeypatch) -> None:
        """Win at 500 bps edge pays bet * 2 * 9500/10000 = 1.90x via the treasury.

        Kill-the-mutant: change the net_payout formula in resolve()."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin, jackpot_app_id=JACKPOT_APP_ID)
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player)
            _settle_round(ctx, commit_round)

            monkeypatch.setattr(
                CoinflipContract, "_read_beacon", lambda self, r: algopy.Bytes(WIN_BYTES)
            )
            monkeypatch.setattr(CoinflipContract, "_accrue_to_jackpot", lambda self, p, b, c: None)
            paid: list[tuple[str, int]] = []
            monkeypatch.setattr(
                CoinflipContract, "_pay_winner", lambda self, p, n: paid.append((str(p), int(n)))
            )

            result = contract.resolve(algopy.arc4.Address(player))
            assert result.native is True
            expected = MIN_BET * 2 * (BPS_DENOMINATOR - HOUSE_EDGE_BPS) // BPS_DENOMINATOR
            assert paid == [(player, expected)]
            assert expected == int(MIN_BET * 1.90)

    def test_resolve_no_referrer_skips_referral_payment(self, monkeypatch) -> None:
        """Zero-address referrer: no referral payment; sweep = bet - jackpot cut."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin, jackpot_app_id=JACKPOT_APP_ID)
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player)
            _settle_round(ctx, commit_round)

            monkeypatch.setattr(
                CoinflipContract, "_read_beacon", lambda self, r: algopy.Bytes(LOSS_BYTES)
            )
            monkeypatch.setattr(CoinflipContract, "_accrue_to_jackpot", lambda self, p, b, c: None)

            contract.resolve(algopy.arc4.Address(player))
            cut = MIN_BET * JACKPOT_BPS // BPS_DENOMINATOR
            all_inner = [t for g in ctx.txn.last_group.itxn_groups for t in g]
            pays = [t for t in all_inner if isinstance(t, PaymentInnerTransaction)]
            assert len(pays) == 3  # cut, sweep, MBR -- no referral
            by_amount = {int(p.amount): str(p.receiver) for p in pays}
            assert by_amount[MIN_BET - cut] == algosdk.logic.get_application_address(
                TREASURY_APP_ID
            )

    def test_resolve_without_jackpot_app_skips_pot(self, monkeypatch) -> None:
        """jackpot_app_id == 0: no pot payment, no accrue; sweep = bet - referral.
        (LocalNet/test deployments must work without a pot.)"""
        admin = _gen_addr()
        player = _gen_addr()
        referrer = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)  # jackpot_app_id=0
            _fund_coinflip(ctx, contract)
            commit_round = _do_flip(ctx, contract, player, referrer=referrer)
            _settle_round(ctx, commit_round)

            monkeypatch.setattr(
                CoinflipContract, "_read_beacon", lambda self, r: algopy.Bytes(LOSS_BYTES)
            )
            accrue_calls: list[object] = []
            monkeypatch.setattr(
                CoinflipContract,
                "_accrue_to_jackpot",
                lambda self, p, b, c: accrue_calls.append(p),
            )

            contract.resolve(algopy.arc4.Address(player))
            assert accrue_calls == []
            referral = MIN_BET * REFERRAL_BPS // BPS_DENOMINATOR
            all_inner = [t for g in ctx.txn.last_group.itxn_groups for t in g]
            pays = [t for t in all_inner if isinstance(t, PaymentInnerTransaction)]
            assert len(pays) == 3  # referral, sweep, MBR -- no pot payment
            by_amount = {int(p.amount): str(p.receiver) for p in pays}
            assert by_amount[MIN_BET - referral] == algosdk.logic.get_application_address(
                TREASURY_APP_ID
            )


# ---------------------------------------------------------------------------
# TestViews
# ---------------------------------------------------------------------------

class TestViews:
    def test_get_flip_state_reverts_when_no_flip(self) -> None:
        """get_flip_state() reverts when no box exists for the address."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            with pytest.raises(AssertionError, match="no active flip for player"):
                contract.get_flip_state(algopy.arc4.Address(player))

    def test_has_active_flip_false_before_flip(self) -> None:
        """has_active_flip() returns False for an address with no active flip."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            assert contract.has_active_flip(algopy.arc4.Address(player)).native is False

    def test_has_active_flip_true_after_flip(self) -> None:
        """has_active_flip() returns True after flip()."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            _do_flip(ctx, contract, player)
            assert contract.has_active_flip(algopy.arc4.Address(player)).native is True

    def test_get_flip_state_returns_correct_fields(self) -> None:
        """get_flip_state() returns the FlipState written by flip() with correct fields."""
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            start_round = int(algopy.Global.round)
            commit_round = _do_flip(ctx, contract, player)

            state = contract.get_flip_state(algopy.arc4.Address(player))
            assert state.bet_amount.native == MIN_BET
            assert state.vrf_round.native == commit_round
            assert state.vrf_round.native == _ceil8_commit(start_round)
            # No referrer was passed (used zero address)
            assert str(state.referrer) == "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
