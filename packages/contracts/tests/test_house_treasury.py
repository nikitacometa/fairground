"""
Tests for HouseTreasury.

Kill-the-mutant check: before committing, comment out a key assertion
in the SUT (e.g., the solvency invariant assert in pay_winner) and
confirm that at least one test here fails. Re-add the assertion.
This is required per the Fairground test conventions (CLAUDE.md).

Test structure:
    - test_create_*       : deployment and initial state
    - test_pause_*        : emergency pause / unpause
    - test_register_*     : game registration
    - test_pay_winner_*   : solvency, auth, and payout path
    - test_refund_path_*  : admin withdrawal path (paused guard)
    - test_max_payout_*   : ceiling enforcement

Uses algorand-python-testing==1.1.0 offline context (no LocalNet required).
Integration tests that hit LocalNet are marked @pytest.mark.localnet.
"""

import pytest

# algorand-python-testing imports.
# These are the actual package names from algorand-python-testing==1.1.0.
# TODO: verify exact import paths once the virtualenv is active.
# The testing framework uses `algopy_testing` as the top-level module.
try:
    from algopy_testing import AlgopyTestContext, algopy_testing_context
except ImportError:
    # Stub so the file is importable without the testing package.
    # Remove this guard once the virtualenv is set up.
    AlgopyTestContext = None  # type: ignore[assignment,misc]
    algopy_testing_context = None  # type: ignore[assignment]

from smart_contracts.house_treasury.contract import HouseTreasury


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

ADMIN_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
PLAYER_ADDRESS = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBDM5HQ"
GAME_ADDRESS = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCBRR3SM"

DEFAULT_MAX_PAYOUT_BPS = 100   # 1%
TREASURY_BALANCE = 10_000_000_000  # 10,000 ALGO in microALGO


@pytest.fixture
def contract_context():
    """
    Return a fresh HouseTreasury contract instance with offline test context.

    TODO: replace with the correct algopy_testing_context() call once
    the exact API is confirmed against algorand-python-testing==1.1.0.
    The pattern below matches the documented API from the testing README.

    deposit() ABI signature:
        deposit(pay: gtxn.PaymentTransaction) -> None
        Caller sends a 2-txn group: payment to treasury + deposit() app call.
        pay.receiver must equal treasury app address.
        total_deposited increments by pay.amount.

    pay_winner() auth:
        Caller must be a registered game contract (stored by app address in BoxMap).
        BoxMap.maybe(key) returns (value, exists) -- check exists before value.
        Solvency: payout <= max_payout_bps% of (balance - min_balance).
    """
    # TODO: set up algopy_testing_context with admin sender and funding.
    # with algopy_testing_context() as ctx:
    #     contract = HouseTreasury()
    #     contract.create(admin=ADMIN_ADDRESS)
    #     yield ctx, contract
    pytest.skip("TODO: set up algopy_testing_context fixture")


# ---------------------------------------------------------------------------
# Deployment tests
# ---------------------------------------------------------------------------

class TestCreate:
    def test_initial_state_is_correct(self, contract_context: object) -> None:
        """After create(), global state matches constructor args."""
        # TODO: ctx, contract = contract_context
        # assert contract.admin.value == ADMIN_ADDRESS
        # assert contract.max_payout_bps.value == DEFAULT_MAX_PAYOUT_BPS
        # assert contract.paused.value == 0
        # assert contract.total_deposited.value == 0
        # assert contract.total_paid_out.value == 0
        pytest.skip("TODO: implement with algopy_testing_context")

    def test_double_create_fails(self, contract_context: object) -> None:
        """Calling create() on an already-created contract must fail."""
        # TODO: assert calling create() a second time raises an error.
        # This verifies the create="require" lifecycle guard on the ABI method.
        pytest.skip("TODO: implement with algopy_testing_context")


# ---------------------------------------------------------------------------
# Pause tests
# ---------------------------------------------------------------------------

class TestPause:
    def test_admin_can_pause(self, contract_context: object) -> None:
        """pause() sets paused = 1. Admin only."""
        # TODO: ctx, contract = contract_context
        # ctx.set_sender(ADMIN_ADDRESS)
        # contract.pause()
        # assert contract.paused.value == 1
        pytest.skip("TODO")

    def test_non_admin_cannot_pause(self, contract_context: object) -> None:
        """pause() reverts if called by non-admin."""
        # TODO: ctx.set_sender(PLAYER_ADDRESS)
        # with pytest.raises(Exception, match="sender is not admin"):
        #     contract.pause()
        pytest.skip("TODO")

    def test_pay_winner_blocked_when_paused(self, contract_context: object) -> None:
        """
        pay_winner() must revert when paused == 1.

        Kill-the-mutant target: remove the `assert self.paused.value == 0` line
        in pay_winner() and confirm this test fails.
        """
        # TODO: pause the contract and then attempt pay_winner().
        # Verify it raises with "treasury is paused".
        pytest.skip("TODO")

    def test_unpause_restores_payouts(self, contract_context: object) -> None:
        """After unpause(), pay_winner() works again."""
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# Game registration tests
# ---------------------------------------------------------------------------

class TestDeposit:
    def test_deposit_increments_total_deposited(self, contract_context: object) -> None:
        """
        deposit(pay) increments total_deposited by pay.amount.

        ABI group pattern:
            Txn[0]: Payment(receiver=treasury_address, amount=X)
            Txn[1]: ApplicationCall to deposit(pay=group[0])

        Kill-the-mutant target: remove `self.total_deposited.value += pay.amount`
        in deposit() and confirm this test fails.
        """
        # TODO: ctx, contract = contract_context
        # pay = ctx.make_payment(sender=PLAYER_ADDRESS, receiver=treasury_address, amount=1_000_000)
        # contract.deposit(pay=pay)
        # assert contract.total_deposited.value == 1_000_000
        pytest.skip("TODO")

    def test_deposit_rejects_wrong_receiver(self, contract_context: object) -> None:
        """deposit() reverts when pay.receiver != treasury app address."""
        # TODO: set pay.receiver = PLAYER_ADDRESS (wrong).
        # Verify raises "payment must go to treasury".
        pytest.skip("TODO")


class TestRegisterGame:
    def test_register_and_query(self, contract_context: object) -> None:
        """register_game() adds app to registered_games; is_game_registered() returns True."""
        pytest.skip("TODO")

    def test_unregistered_game_cannot_pay_winner(self, contract_context: object) -> None:
        """
        pay_winner() must revert when called by an unregistered address.

        Kill-the-mutant target: remove the registration check in pay_winner()
        and confirm this test fails.
        """
        # TODO: call pay_winner() from an unregistered sender.
        # Verify it raises with "caller not registered game".
        pytest.skip("TODO")

    def test_deregister_removes_access(self, contract_context: object) -> None:
        """deregister_game() removes the entry; subsequent pay_winner() from that app reverts."""
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# Solvency / pay_winner tests
# ---------------------------------------------------------------------------

class TestPayWinner:
    def test_payout_within_ceiling_succeeds(self, contract_context: object) -> None:
        """
        pay_winner() succeeds when payout <= max_payout_bps% of live balance.

        With 10,000 ALGO treasury and 1% ceiling, max payout = 100 ALGO.
        A payout of 98 ALGO (2x bet of 0.5 ALGO, net after 2% edge) must succeed.
        """
        pytest.skip("TODO")

    def test_payout_above_ceiling_reverts(self, contract_context: object) -> None:
        """
        pay_winner() must revert when payout > max_payout_bps% of live balance.

        Kill-the-mutant target: remove the solvency assert in pay_winner()
        and confirm this test fails. This is the most critical invariant.

        With 1,000 ALGO treasury (10x reduced) and 1% ceiling,
        max payout = 10 ALGO. Requesting 15 ALGO must revert.
        """
        # TODO: set treasury balance to 1,000 ALGO.
        # Attempt pay_winner() with 15 ALGO.
        # Verify raises "payout exceeds max_payout_bps of live balance".
        pytest.skip("TODO")

    def test_zero_payout_reverts(self, contract_context: object) -> None:
        """pay_winner() must revert on zero payout amount."""
        pytest.skip("TODO")

    def test_total_paid_out_increments(self, contract_context: object) -> None:
        """total_paid_out increases by payout amount after each successful pay_winner()."""
        pytest.skip("TODO")

    @pytest.mark.parametrize("bet_microalgo,expected_max_payout", [
        (500_000, 980_000),      # 0.5 ALGO bet → 0.98 ALGO payout (1.96x net)
        (1_000_000, 1_960_000),  # 1.0 ALGO → 1.96 ALGO
        (100_000_000, None),     # 100 ALGO bet would exceed 1% of 2000 ALGO treasury
    ])
    def test_payout_math(
        self,
        contract_context: object,
        bet_microalgo: int,
        expected_max_payout: int | None,
    ) -> None:
        """
        Parametrized payout math verification.

        Kill-the-mutant: comment out the max_payout calculation in pay_winner()
        and confirm at least one parametrize case fails.
        """
        pytest.skip("TODO: implement parametrized payout verification")


# ---------------------------------------------------------------------------
# Emergency withdrawal tests
# ---------------------------------------------------------------------------

class TestEmergencyWithdraw:
    def test_withdraw_requires_paused(self, contract_context: object) -> None:
        """emergency_withdraw() must revert when paused == 0."""
        # TODO: call emergency_withdraw() without pausing first.
        # Verify raises "must pause before emergency withdrawal".
        pytest.skip("TODO")

    def test_withdraw_when_paused_succeeds(self, contract_context: object) -> None:
        """emergency_withdraw() succeeds for admin when paused == 1."""
        pytest.skip("TODO")

    def test_non_admin_withdraw_reverts(self, contract_context: object) -> None:
        """emergency_withdraw() reverts for non-admin even when paused."""
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# Max payout ceiling tests
# ---------------------------------------------------------------------------

class TestMaxPayoutBps:
    def test_ceiling_update_applies_immediately(self, contract_context: object) -> None:
        """Changing max_payout_bps takes effect on the next pay_winner() call."""
        pytest.skip("TODO")

    def test_ceiling_hard_cap_at_1000(self, contract_context: object) -> None:
        """set_max_payout_bps() reverts when bps > 1000 (10%)."""
        pytest.skip("TODO")
