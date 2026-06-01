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
    BOX_MBR,
    REFUND_WINDOW_ROUNDS,
    HOUSE_EDGE_BPS,
    BPS_DENOMINATOR,
    REFERRAL_BPS,
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

TREASURY_APP_ID = 2001
BEACON_APP_ID = 2002
MIN_BET = 500_000   # 0.5 ALGO
MAX_BET = 500_000   # 0.5 ALGO (v1 hard cap)
SAMPLE_SALT = bytes(range(32))


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
) -> CoinflipContract:
    """Deploy a fresh CoinflipContract."""
    ctx.any.application(id=TREASURY_APP_ID)
    ctx.any.application(id=BEACON_APP_ID)
    contract = CoinflipContract()
    contract.create(
        admin=algopy.arc4.Address(admin),
        treasury_app_id=algopy.arc4.UInt64(TREASURY_APP_ID),
        beacon_app_id=algopy.arc4.UInt64(BEACON_APP_ID),
        min_bet=algopy.arc4.UInt64(min_bet),
        max_bet=algopy.arc4.UInt64(max_bet),
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

            assert commit_round == start_round + BEACON_DELAY
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
    def test_resolve_returns_false_when_no_box(self) -> None:
        """resolve() returns False when the player has no active flip (idempotency).

        Kill-the-mutant: remove the `if player not in self.flips: return False`
        guard and confirm this test fails (it would raise instead of returning False).
        """
        admin = _gen_addr()
        player = _gen_addr()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            result = contract.resolve(algopy.arc4.Address(player))
            assert result.native is False

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

    def test_set_beacon_app_id_updates_global_state(self) -> None:
        """set_beacon_app_id() updates beacon_app_id global state."""
        admin = _gen_addr()
        NEW_BEACON = 3999
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_coinflip(ctx, admin)
            ctx.any.application(id=NEW_BEACON)
            contract.set_beacon_app_id(algopy.arc4.UInt64(NEW_BEACON))
            assert int(contract.beacon_app_id.value) == NEW_BEACON


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
            assert state.vrf_round.native == start_round + BEACON_DELAY
            # No referrer was passed (used zero address)
            assert str(state.referrer) == "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
