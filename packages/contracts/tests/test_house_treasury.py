"""
Tests for HouseTreasury.

Kill-the-mutant check: before committing, comment out a key assertion in the SUT
(e.g., the solvency invariant assert in pay_winner) and confirm that at least one
test here fails. Re-add the assertion before pushing.

Uses algorand-python-testing==1.1.0 offline context (no LocalNet required).
"""

from __future__ import annotations

import pytest
import algosdk
import algosdk.logic
from algopy_testing import algopy_testing_context
import algopy
from _algopy_testing.primitives import UInt64
from _algopy_testing.itxn import ApplicationCallInnerTransaction, PaymentInnerTransaction

from smart_contracts.house_treasury.contract import (
    HouseTreasury,
    DEFAULT_MAX_PAYOUT_BPS,
    MAX_PAYOUT_BPS_CEILING,
    GAME_BOX_MBR,
    EMERGENCY_TIMELOCK_ROUNDS,
)


# ---------------------------------------------------------------------------
# Test fixtures / helpers
# ---------------------------------------------------------------------------

def _make_accounts() -> tuple[str, str, str]:
    """Return (admin, player, referrer) as valid Algorand addresses."""
    _, admin = algosdk.account.generate_account()
    _, player = algosdk.account.generate_account()
    _, extra = algosdk.account.generate_account()
    return admin, player, extra


def _deploy_treasury(ctx, admin: str) -> HouseTreasury:
    """Deploy a fresh HouseTreasury and return the contract instance."""
    contract = HouseTreasury()
    contract.create(admin=algopy.arc4.Address(admin))
    return contract


def _treasury_addr(contract: HouseTreasury) -> str:
    return algosdk.logic.get_application_address(contract.__app_id__)


def _register_game(ctx, contract: HouseTreasury, game_app_id: int, admin: str) -> str:
    """Register a game app with the treasury. Returns game address string."""
    treasury_addr = _treasury_addr(contract)
    pay = ctx.any.txn.payment(
        sender=algopy.Account(admin),
        receiver=algopy.Account(treasury_addr),
        amount=UInt64(GAME_BOX_MBR),
    )
    contract.register_game(algopy.arc4.UInt64(game_app_id), pay)
    return algosdk.logic.get_application_address(game_app_id)


# ---------------------------------------------------------------------------
# TestCreate
# ---------------------------------------------------------------------------

class TestCreate:
    def test_initial_state_matches_args(self) -> None:
        """After create(), all global state fields match defaults."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            assert str(contract.admin.value) == admin
            assert int(contract.max_payout_bps.value) == DEFAULT_MAX_PAYOUT_BPS
            assert int(contract.paused.value) == 0
            assert int(contract.total_deposited.value) == 0
            assert int(contract.total_paid_out.value) == 0
            assert int(contract.withdraw_request_round.value) == 0


# ---------------------------------------------------------------------------
# TestSetMaxPayoutBps
# ---------------------------------------------------------------------------

class TestSetMaxPayoutBps:
    def test_rejects_zero(self) -> None:
        """set_max_payout_bps(0) must revert."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            with pytest.raises(AssertionError, match="must be positive"):
                contract.set_max_payout_bps(algopy.arc4.UInt64(0))

    def test_rejects_above_ceiling(self) -> None:
        """set_max_payout_bps(> 1000) must revert.

        Kill-the-mutant: remove the MAX_PAYOUT_BPS_CEILING check in the SUT
        and confirm this test fails.
        """
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            with pytest.raises(AssertionError, match="cannot exceed 1000"):
                contract.set_max_payout_bps(algopy.arc4.UInt64(MAX_PAYOUT_BPS_CEILING + 1))

    def test_accepts_ceiling_exactly(self) -> None:
        """set_max_payout_bps(1000) should succeed (inclusive boundary)."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            contract.set_max_payout_bps(algopy.arc4.UInt64(MAX_PAYOUT_BPS_CEILING))
            assert int(contract.max_payout_bps.value) == MAX_PAYOUT_BPS_CEILING

    def test_non_admin_rejected(self) -> None:
        """set_max_payout_bps reverts for non-admin."""
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            with ctx.txn.create_group(active_txn_overrides={"sender": algopy.Account(player)}):
                with pytest.raises(AssertionError, match="sender is not admin"):
                    contract.set_max_payout_bps(algopy.arc4.UInt64(200))

    @pytest.mark.parametrize("bps", [1, 100, 500, 999, 1000])
    def test_accepts_valid_bps_range(self, bps: int) -> None:
        """Parametrized: all values in [1, 1000] must be accepted."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            contract.set_max_payout_bps(algopy.arc4.UInt64(bps))
            assert int(contract.max_payout_bps.value) == bps


# ---------------------------------------------------------------------------
# TestRegisterGame
# ---------------------------------------------------------------------------

class TestRegisterGame:
    def test_register_requires_mbr_payment(self) -> None:
        """register_game reverts when the grouped payment is below GAME_BOX_MBR."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            game_app = ctx.any.application(id=3001)

            short_pay = ctx.any.txn.payment(
                sender=algopy.Account(admin),
                receiver=algopy.Account(treasury_addr),
                amount=UInt64(GAME_BOX_MBR - 1),
            )
            with pytest.raises(AssertionError, match="insufficient MBR payment"):
                contract.register_game(algopy.arc4.UInt64(3001), short_pay)

    def test_register_requires_payment_to_treasury(self) -> None:
        """register_game reverts when pay.receiver != treasury address."""
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            ctx.any.application(id=3001)

            wrong_pay = ctx.any.txn.payment(
                sender=algopy.Account(admin),
                receiver=algopy.Account(player),
                amount=UInt64(GAME_BOX_MBR),
            )
            with pytest.raises(AssertionError, match="MBR payment must go to treasury"):
                contract.register_game(algopy.arc4.UInt64(3001), wrong_pay)

    def test_register_game_marks_registered(self) -> None:
        """After register_game(), is_game_registered() returns True."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            ctx.any.application(id=4001)
            _register_game(ctx, contract, 4001, admin)
            assert contract.is_game_registered(algopy.arc4.UInt64(4001)).native is True

    def test_unregistered_game_not_in_registry(self) -> None:
        """is_game_registered() returns False for an app that was never registered."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            ctx.any.application(id=5001)
            # do NOT register it
            assert contract.is_game_registered(algopy.arc4.UInt64(5001)).native is False


# ---------------------------------------------------------------------------
# TestPayWinner
# ---------------------------------------------------------------------------

class TestPayWinner:
    def _setup(
        self,
        treasury_balance: int = 10_000_000_000,  # 10,000 ALGO
        min_balance: int = 100_000,
    ) -> tuple:
        """Deploy treasury, register one game, fund treasury, return (ctx, contract, admin, player, game_addr)."""
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        GAME_APP_ID = 7001

        ctx_obj = algopy_testing_context(default_sender=admin)
        ctx = ctx_obj.__enter__()

        contract = _deploy_treasury(ctx, admin)
        treasury_addr = _treasury_addr(contract)

        ctx.any.application(id=GAME_APP_ID)
        game_addr = _register_game(ctx, contract, GAME_APP_ID, admin)

        ctx.ledger.update_account(
            treasury_addr,
            balance=UInt64(treasury_balance),
            min_balance=UInt64(min_balance),
        )

        return ctx, ctx_obj, contract, admin, player, game_addr

    def test_reverts_for_unregistered_caller(self) -> None:
        """pay_winner reverts when Txn.sender is not in the game registry.

        Kill-the-mutant: remove the registration check in pay_winner() and
        confirm this test fails.
        """
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        _, unregistered = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(10_000_000_000),
                min_balance=UInt64(100_000),
            )
            with ctx.txn.create_group(
                active_txn_overrides={"sender": algopy.Account(unregistered)}
            ):
                with pytest.raises(AssertionError, match="caller is not a registered game"):
                    contract.pay_winner(
                        algopy.arc4.Address(player),
                        algopy.arc4.UInt64(1_000_000),
                    )

    def test_reverts_when_paused(self) -> None:
        """pay_winner reverts when paused == 1.

        Kill-the-mutant: remove the pause check in pay_winner() and confirm
        this test fails.
        """
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        GAME_APP_ID = 8001
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.any.application(id=GAME_APP_ID)
            game_addr = _register_game(ctx, contract, GAME_APP_ID, admin)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(10_000_000_000),
                min_balance=UInt64(100_000),
            )
            contract.pause()
            with ctx.txn.create_group(
                active_txn_overrides={"sender": algopy.Account(game_addr)}
            ):
                with pytest.raises(AssertionError, match="treasury is paused"):
                    contract.pay_winner(
                        algopy.arc4.Address(player),
                        algopy.arc4.UInt64(1_000_000),
                    )

    def test_reverts_when_payout_exceeds_max_payout_bps(self) -> None:
        """pay_winner reverts when payout > max_payout_bps% of spendable balance.

        Setup: 1,000 ALGO treasury, 1% ceiling => max_payout = 9.99 ALGO.
        Request: 15 ALGO (> 10 ALGO max) => must revert.

        This is THE solvency invariant. Kill-the-mutant: remove the assert in
        pay_winner() and confirm this test fails.
        """
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        GAME_APP_ID = 9001
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.any.application(id=GAME_APP_ID)
            game_addr = _register_game(ctx, contract, GAME_APP_ID, admin)
            # 1,000 ALGO treasury, min_balance 100_000 microALGO
            # spendable = 1_000_000_000 - 100_000 = 999_900_000
            # max_payout at 1% = 9_999_000 microALGO (~9.999 ALGO)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(1_000_000_000),
                min_balance=UInt64(100_000),
            )
            with ctx.txn.create_group(
                active_txn_overrides={"sender": algopy.Account(game_addr)}
            ):
                with pytest.raises(
                    AssertionError, match="payout exceeds max_payout_bps"
                ):
                    contract.pay_winner(
                        algopy.arc4.Address(player),
                        algopy.arc4.UInt64(15_000_000),  # 15 ALGO
                    )

    def test_succeeds_within_solvency_ceiling(self) -> None:
        """pay_winner succeeds when payout is within 1% of spendable balance.

        10,000 ALGO treasury => spendable = 9,999.9 ALGO => 1% = ~99.999 ALGO.
        A 98 ALGO payout (2x 0.5 ALGO bet × 9800/10000 = 980_000) must pass.
        """
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        GAME_APP_ID = 9101
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.any.application(id=GAME_APP_ID)
            game_addr = _register_game(ctx, contract, GAME_APP_ID, admin)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(10_000_000_000),
                min_balance=UInt64(100_000),
            )
            with ctx.txn.create_group(
                active_txn_overrides={"sender": algopy.Account(game_addr)}
            ):
                contract.pay_winner(
                    algopy.arc4.Address(player),
                    algopy.arc4.UInt64(980_000),  # 0.98 ALGO (standard win on 0.5 ALGO bet)
                )
            assert int(contract.total_paid_out.value) == 980_000

    def test_total_paid_out_increments(self) -> None:
        """total_paid_out accumulates correctly across multiple calls."""
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        GAME_APP_ID = 9201
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.any.application(id=GAME_APP_ID)
            game_addr = _register_game(ctx, contract, GAME_APP_ID, admin)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(10_000_000_000),
                min_balance=UInt64(100_000),
            )
            for _ in range(3):
                with ctx.txn.create_group(
                    active_txn_overrides={"sender": algopy.Account(game_addr)}
                ):
                    contract.pay_winner(
                        algopy.arc4.Address(player),
                        algopy.arc4.UInt64(980_000),
                    )
            assert int(contract.total_paid_out.value) == 3 * 980_000

    def test_zero_payout_reverts(self) -> None:
        """pay_winner reverts on zero payout."""
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        GAME_APP_ID = 9301
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.any.application(id=GAME_APP_ID)
            game_addr = _register_game(ctx, contract, GAME_APP_ID, admin)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(10_000_000_000),
                min_balance=UInt64(100_000),
            )
            with ctx.txn.create_group(
                active_txn_overrides={"sender": algopy.Account(game_addr)}
            ):
                with pytest.raises(AssertionError, match="payout must be positive"):
                    contract.pay_winner(
                        algopy.arc4.Address(player),
                        algopy.arc4.UInt64(0),
                    )

    @pytest.mark.parametrize(
        "treasury_algo,payout_microalgo,should_pass",
        [
            # 10_000 ALGO, spendable = 9_999.9 ALGO, 1% = 99.999 ALGO
            (10_000_000_000, 980_000, True),     # 0.98 ALGO << 99.999 ALGO max
            (10_000_000_000, 99_000_000, True),  # 99 ALGO < 99.999 ALGO max
            # 1_000 ALGO, spendable = 999.9 ALGO, 1% = 9.999 ALGO
            (1_000_000_000, 9_999_000, True),    # just under ceiling
            (1_000_000_000, 10_000_000, False),  # exactly ceiling (900 microALGO over)
            (1_000_000_000, 15_000_000, False),  # 15 ALGO >> 9.999 max
        ],
    )
    def test_solvency_boundary_parametrized(
        self,
        treasury_algo: int,
        payout_microalgo: int,
        should_pass: bool,
    ) -> None:
        """Parametrized: verify solvency boundary enforcement.

        Kill-the-mutant: change the max_payout formula in pay_winner() and confirm
        at least one parametrized case fails.
        """
        _, admin = algosdk.account.generate_account()
        _, player = algosdk.account.generate_account()
        GAME_APP_ID = 9401
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.any.application(id=GAME_APP_ID)
            game_addr = _register_game(ctx, contract, GAME_APP_ID, admin)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(treasury_algo),
                min_balance=UInt64(100_000),
            )
            with ctx.txn.create_group(
                active_txn_overrides={"sender": algopy.Account(game_addr)}
            ):
                if should_pass:
                    contract.pay_winner(
                        algopy.arc4.Address(player),
                        algopy.arc4.UInt64(payout_microalgo),
                    )
                else:
                    with pytest.raises(AssertionError):
                        contract.pay_winner(
                            algopy.arc4.Address(player),
                            algopy.arc4.UInt64(payout_microalgo),
                        )


# ---------------------------------------------------------------------------
# TestEmergencyWithdraw
# ---------------------------------------------------------------------------

class TestEmergencyWithdraw:
    def test_withdraw_requires_prior_request(self) -> None:
        """emergency_withdraw reverts when no request was made (withdraw_request_round == 0)."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(10_000_000_000),
                min_balance=UInt64(100_000),
            )
            # Pause first (required by emergency_withdraw)
            contract.pause()
            with pytest.raises(AssertionError, match="no withdrawal requested"):
                contract.emergency_withdraw(algopy.arc4.UInt64(1_000_000))

    def test_withdraw_requires_pause(self) -> None:
        """emergency_withdraw reverts when not paused."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            # Not paused, no request
            with pytest.raises(AssertionError, match="must pause"):
                contract.emergency_withdraw(algopy.arc4.UInt64(1_000_000))

    def test_withdraw_reverts_before_timelock(self) -> None:
        """emergency_withdraw reverts before the 48h timelock has elapsed.

        Kill-the-mutant: remove the timelock check in emergency_withdraw() and
        confirm this test fails.
        """
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(10_000_000_000),
                min_balance=UInt64(100_000),
            )
            contract.pause()
            request_round = int(algopy.Global.round)
            contract.request_emergency_withdraw()
            assert int(contract.withdraw_request_round.value) == request_round

            # Advance to just before the timelock expires
            ctx.ledger.patch_global_fields(
                round=request_round + EMERGENCY_TIMELOCK_ROUNDS - 1
            )
            with pytest.raises(AssertionError, match="timelock has not elapsed"):
                contract.emergency_withdraw(algopy.arc4.UInt64(1_000_000))

    def test_withdraw_succeeds_after_timelock(self) -> None:
        """emergency_withdraw succeeds after the 48h timelock and resets request round."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            treasury_addr = _treasury_addr(contract)
            ctx.ledger.update_account(
                treasury_addr,
                balance=UInt64(10_000_000_000),
                min_balance=UInt64(100_000),
            )
            contract.pause()
            request_round = int(algopy.Global.round)
            contract.request_emergency_withdraw()

            ctx.ledger.patch_global_fields(
                round=request_round + EMERGENCY_TIMELOCK_ROUNDS
            )
            contract.emergency_withdraw(algopy.arc4.UInt64(1_000_000))
            # request_round is reset to 0 after successful withdrawal
            assert int(contract.withdraw_request_round.value) == 0

    def test_request_requires_pause_first(self) -> None:
        """request_emergency_withdraw requires pause to be set first."""
        _, admin = algosdk.account.generate_account()
        with algopy_testing_context(default_sender=admin) as ctx:
            contract = _deploy_treasury(ctx, admin)
            # Not paused
            with pytest.raises(AssertionError, match="must pause before requesting"):
                contract.request_emergency_withdraw()
