"""
Tests for CoinflipContract.

Kill-the-mutant check: before committing, comment out a key assertion
in the SUT (e.g., the idempotency guard `del self.flips[player]` at the end
of resolve()) and confirm that at least one test here fails. Re-add before
pushing. Required per Fairground test conventions (CLAUDE.md).

Test structure:
    - test_create_*      : deployment and initial global state
    - test_flip_*        : bet commitment path, box creation, validation
    - test_resolve_*     : resolution path, outcome derivation, payout, idempotency
    - test_refund_*      : 48h player-triggered refund backdoor
    - test_admin_*       : admin-gated operations (pause, set_min_bet, etc.)
    - test_jackpot_*     : jackpot hook (v1 disabled; tests verify zero-rate no-op)
    - test_leaderboard_* : leaderboard inner call enable/disable

Uses algorand-python-testing==1.1.0 offline context. LocalNet integration tests
are marked @pytest.mark.localnet and skipped in CI unless LOCALNET=1 is set.

Reference economics:
    min_bet = max_bet = 500_000 microALGO (0.5 ALGO)
    house_edge = 2% (200 bps)
    gross_payout on win = 1_000_000 microALGO (bet * 2)
    net_payout on win   =   980_000 microALGO (gross * 9800 / 10000)
    referral_amount     =     1_250 microALGO (bet * 25 / 10000 = 0.25%)
    box_mbr             =    49_700 microALGO
        key: 5-byte "flip:" + 32-byte address = 37 bytes
        value: FlipState = vrf_round(8)+bet_amount(8)+salt_hash(32)+claimed(1)+referrer(32) = 81 bytes
        MBR = 2500 + 400*(37+81) = 2500 + 47200 = 49700
    beacon_delay        = 8 rounds (N+8)
    refund_window       = 69_120 rounds (~48h at 2.5s/block: 48*3600/2.5)

flip() ABI signature change (v1):
    flip(pay: gtxn.PaymentTransaction, salt_hash: arc4.StaticArray[Byte,32], referrer: arc4.Address)
    The payment transaction is passed as an ABI grouped-transaction parameter, NOT indexed
    via gtxn.PaymentTransaction(Txn.group_index - 1). The caller must send a 2-txn group:
        Txn[0]: payment to contract (bet + BOX_MBR)
        Txn[1]: app call to flip(pay, salt_hash, referrer)
"""

import pytest

# algorand-python-testing imports.
# Module is `algopy_testing`; exact context API confirmed from testing README.
# TODO: verify import paths once virtualenv is active.
try:
    from algopy_testing import AlgopyTestContext, algopy_testing_context
except ImportError:
    AlgopyTestContext = None  # type: ignore[assignment,misc]
    algopy_testing_context = None  # type: ignore[assignment]

from smart_contracts.coinflip.contract import CoinflipContract, FlipState


# ---------------------------------------------------------------------------
# Shared test constants
# ---------------------------------------------------------------------------

ADMIN_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
PLAYER_ADDRESS = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBDM5HQ"
PLAYER2_ADDRESS = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDUAPZU"
TREASURY_APP_ID = 1001
BEACON_APP_ID = 947957720  # mainnet VRF beacon
LEADERBOARD_APP_ID = 1002

MIN_BET = 500_000   # 0.5 ALGO in microALGO
MAX_BET = 500_000   # 0.5 ALGO in microALGO (v1 hard cap)
# MBR = 2500 + 400*(37+81) = 49700 microALGO
# FlipState: vrf_round(8)+bet_amount(8)+salt_hash(32)+claimed(1)+referrer(32) = 81 bytes
BOX_MBR = 49_700

HOUSE_EDGE_BPS = 200        # 2%
BPS_DENOMINATOR = 10_000
BEACON_DELAY = 8            # rounds
# ~48h at 2.5s/block: 48 * 3600 / 2.5 = 69120 rounds
REFUND_WINDOW_ROUNDS = 69_120

# A deterministic 32-byte salt hash used across tests.
SAMPLE_SALT_HASH = bytes(range(32))

# Zero address for "no referrer" case.
ZERO_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def coinflip_context():
    """
    Return a fresh CoinflipContract instance with offline test context.

    TODO: replace skip with actual algopy_testing_context() call once
    the exact API is confirmed against algorand-python-testing==1.1.0.

    Expected setup:
        with algopy_testing_context() as ctx:
            ctx.set_sender(ADMIN_ADDRESS)
            ctx.fund(contract_address, amount=10_000_000_000)  # 10k ALGO
            contract = CoinflipContract()
            contract.create(
                admin=ADMIN_ADDRESS,
                treasury_app_id=TREASURY_APP_ID,
                beacon_app_id=BEACON_APP_ID,
                min_bet=MIN_BET,
                max_bet=MAX_BET,
            )
            yield ctx, contract

    flip() call pattern (2-txn group):
        ctx.set_group([
            ctx.make_payment(sender=PLAYER_ADDRESS, receiver=contract_address, amount=MIN_BET + BOX_MBR),
            ctx.make_app_call(sender=PLAYER_ADDRESS, app_id=contract_app_id),
        ])
        # Pass pay= as the first ABI arg (the payment group txn reference)
        contract.flip(pay=ctx.group[0], salt_hash=SAMPLE_SALT_HASH, referrer=ZERO_ADDRESS)
    """
    pytest.skip(
        "TODO: implement coinflip_context fixture with algopy_testing_context(). "
        "Remove skip once virtualenv is active and API is verified."
    )


# ---------------------------------------------------------------------------
# Deployment tests
# ---------------------------------------------------------------------------

class TestCreate:
    def test_initial_global_state_matches_args(self, coinflip_context: object) -> None:
        """
        After create(), all global state fields match the constructor arguments.

        Kill-the-mutant target: comment out one GlobalState assignment in create()
        and confirm this test catches the missing field.
        """
        # TODO: ctx, contract = coinflip_context
        # assert contract.admin.value == ADMIN_ADDRESS
        # assert contract.treasury_app_id.value == TREASURY_APP_ID
        # assert contract.beacon_app_id.value == BEACON_APP_ID
        # assert contract.min_bet.value == MIN_BET
        # assert contract.max_bet.value == MAX_BET
        # assert contract.paused.value == 0
        # assert contract.jackpot_bps.value == 0        # disabled in v1
        # assert contract.jackpot_balance.value == 0
        # assert contract.total_bets.value == 0
        # assert contract.total_volume.value == 0
        # assert contract.leaderboard_app_id.value == 0  # disabled at deploy
        pytest.skip("TODO")

    def test_double_create_fails(self, coinflip_context: object) -> None:
        """create() on an already-created contract must fail (create='require' guard)."""
        # TODO: attempt second create() call; verify it raises.
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# flip() -- bet commitment path
# ---------------------------------------------------------------------------

class TestFlip:
    def test_flip_creates_box_and_commits_round(self, coinflip_context: object) -> None:
        """
        flip(pay, salt_hash, referrer) stores a FlipState box for the player
        at the correct VRF round.

        Box key = player address (32 bytes).
        Committed VRF round = current_round + 8 (BEACON_DELAY).
        FlipState.referrer is stored and readable via get_flip_state().

        Kill-the-mutant target: change BEACON_DELAY constant to 4 and confirm
        this test catches the wrong commit round.
        """
        # TODO: ctx, contract = coinflip_context
        # current_round = ctx.get_current_round()
        # pay = ctx.make_payment(sender=PLAYER_ADDRESS, receiver=contract_address, amount=MIN_BET + BOX_MBR)
        # ctx.set_sender(PLAYER_ADDRESS)
        # returned_round = contract.flip(pay=pay, salt_hash=SAMPLE_SALT_HASH, referrer=ZERO_ADDRESS)
        # assert returned_round == current_round + BEACON_DELAY
        # state, exists = contract.flips.maybe(PLAYER_ADDRESS)
        # assert exists
        # assert state.bet_amount.native == MIN_BET
        # assert state.vrf_round.native == current_round + BEACON_DELAY
        # assert not state.claimed.native
        # assert contract.total_bets.value == 1
        # assert contract.total_volume.value == MIN_BET
        pytest.skip("TODO")

    def test_flip_rejects_duplicate_active_flip(self, coinflip_context: object) -> None:
        """
        A second flip() from the same player while first is unclaimed must revert.

        One active flip per address. The box key uniqueness enforces this.
        """
        # TODO: submit two flip() calls from PLAYER_ADDRESS without resolving.
        # Verify second raises "player already has an active flip".
        pytest.skip("TODO")

    def test_flip_rejects_bet_below_minimum(self, coinflip_context: object) -> None:
        """flip() reverts when payment - BOX_MBR < min_bet."""
        # TODO: set pay.amount = BOX_MBR + MIN_BET - 1.
        # Verify raises "bet below minimum".
        pytest.skip("TODO")

    def test_flip_rejects_bet_above_maximum(self, coinflip_context: object) -> None:
        """flip() reverts when bet > max_bet."""
        # TODO: set pay.amount = BOX_MBR + MAX_BET + 1_000_000.
        # Verify raises "bet above maximum".
        pytest.skip("TODO")

    def test_flip_reverts_when_paused(self, coinflip_context: object) -> None:
        """flip() must revert when paused == 1."""
        # TODO: admin pauses, then player attempts flip().
        # Verify raises "contract is paused".
        pytest.skip("TODO")

    def test_flip_rejects_payment_to_wrong_receiver(self, coinflip_context: object) -> None:
        """flip() reverts when pay.receiver != contract address."""
        # TODO: set pay.receiver = PLAYER_ADDRESS (wrong).
        # Verify raises "payment must go to contract".
        pytest.skip("TODO")

    def test_flip_rejects_self_referral(self, coinflip_context: object) -> None:
        """flip() reverts when referrer == Txn.sender (no self-referral)."""
        # TODO: set referrer = PLAYER_ADDRESS (same as sender).
        # Verify raises "referrer cannot be player".
        pytest.skip("TODO")

    @pytest.mark.parametrize("bet_microalgo", [
        500_000,    # exactly min/max (v1 hard cap)
    ])
    def test_flip_accepts_valid_bet_amounts(
        self,
        coinflip_context: object,
        bet_microalgo: int,
    ) -> None:
        """
        Parametrized: valid bet amounts are accepted without error.

        Kill-the-mutant: comment out the min/max bet assertions in flip()
        and confirm at least one parametrized case still catches a boundary error.
        """
        pytest.skip("TODO: implement parametrized flip acceptance test")


# ---------------------------------------------------------------------------
# resolve() -- resolution path
# ---------------------------------------------------------------------------

class TestResolve:
    def test_resolve_path_loss(self, coinflip_context: object) -> None:
        """
        resolve() with a losing VRF output: no payout, box deleted.

        Setup: force VRF output so that sha256(output || salt_hash)[0] % 2 == 0.
        Verify: no inner payment to player, box is deleted (MBR reclaimed).
        """
        # TODO: ctx, contract = coinflip_context
        # pay = ctx.make_payment(...)
        # contract.flip(pay=pay, salt_hash=SAMPLE_SALT_HASH, referrer=ZERO_ADDRESS)
        # ctx.advance_rounds(BEACON_DELAY)
        # ctx.mock_vrf_output(beacon_round=commit_round, output=LOSING_VRF_BYTES)
        # result = contract.resolve(player=PLAYER_ADDRESS)
        # assert not result.native  # player lost
        # _, exists = contract.flips.maybe(PLAYER_ADDRESS)
        # assert not exists  # box deleted
        pytest.skip("TODO")

    def test_resolve_path_win(self, coinflip_context: object) -> None:
        """
        resolve() with a winning VRF output: inner pay_winner() called, box deleted.

        Setup: force VRF output so that sha256(output || salt_hash)[0] % 2 == 1.
        Verify: inner app call to treasury.pay_winner() with net_to_player.
        No referrer: net_to_player = net_payout = bet * 2 * 9800 / 10000 = 980_000.

        Kill-the-mutant target: change HOUSE_EDGE_BPS from 200 to 0 in the SUT
        and confirm this test catches the incorrect payout amount.
        """
        # TODO: mock treasury app call; verify correct payout amount.
        # expected_payout = MIN_BET * 2 * (BPS_DENOMINATOR - HOUSE_EDGE_BPS) // BPS_DENOMINATOR
        # assert expected_payout == 980_000
        # ...
        pytest.skip("TODO")

    def test_resolve_path_win_with_referrer(self, coinflip_context: object) -> None:
        """
        resolve() with win + referrer set: referral_amount sent to referrer,
        reduced net_to_player sent to winner via treasury.

        referral_amount = bet * 25 / 10000 = 1250 microALGO (for 500k bet)
        net_to_player   = net_payout - referral_amount = 980_000 - 1_250 = 978_750
        """
        # TODO: flip with referrer=PLAYER2_ADDRESS, win, verify:
        # - inner Payment to PLAYER2_ADDRESS of 1250 microALGO
        # - inner ApplicationCall to treasury with 978_750 microALGO
        pytest.skip("TODO")

    def test_resolve_is_idempotent_box_deleted(self, coinflip_context: object) -> None:
        """
        Second resolve() after first returns False immediately (box missing).

        The box deletion is the idempotency guard -- no double payout possible.

        Kill-the-mutant target: remove `del self.flips[player]` from resolve()
        and confirm this test catches the missing deletion (second call succeeds).
        """
        # TODO: resolve once, verify box deleted.
        # Then call resolve() again; verify returns False (box missing path).
        pytest.skip("TODO")

    def test_resolve_reverts_before_beacon_round(self, coinflip_context: object) -> None:
        """
        resolve() must revert if called before the committed VRF round has passed.
        """
        # TODO: flip(), then immediately resolve() without advancing rounds.
        # Verify raises "VRF beacon not yet settled".
        pytest.skip("TODO")

    def test_resolve_is_permissionless(self, coinflip_context: object) -> None:
        """
        resolve() can be called by any account, not just the player.

        The keeper calls it; players can also self-resolve.
        Verify that PLAYER2_ADDRESS can resolve PLAYER_ADDRESS's flip.
        """
        # TODO: flip as PLAYER_ADDRESS, then resolve as PLAYER2_ADDRESS.
        # Verify no permission error.
        pytest.skip("TODO")

    def test_resolve_reverts_when_paused(self, coinflip_context: object) -> None:
        """resolve() must revert when paused == 1."""
        pytest.skip("TODO")

    @pytest.mark.parametrize("bet_microalgo,expected_net_payout", [
        (500_000,    980_000),   # 0.5 ALGO bet -> 0.98 ALGO net (no referrer)
        # Additional bet sizes if min/max are changed in future versions:
        # (1_000_000, 1_960_000),
        # (250_000,     490_000),
    ])
    def test_resolve_payout_math_parametrized(
        self,
        coinflip_context: object,
        bet_microalgo: int,
        expected_net_payout: int,
    ) -> None:
        """
        Parametrized: verify that net payout = bet * 2 * (10000 - 200) / 10000.

        Kill-the-mutant: change the division denominator in resolve() and confirm
        at least one parametrized case fails.
        """
        pytest.skip("TODO: implement parametrized payout math test")


# ---------------------------------------------------------------------------
# refund() -- 48h player-triggered refund backdoor
# ---------------------------------------------------------------------------

class TestRefund:
    def test_refund_path_after_48h(self, coinflip_context: object) -> None:
        """
        refund() succeeds when elapsed >= REFUND_WINDOW_ROUNDS (69_120 rounds, ~48h).

        Player recovers their bet from treasury via pay_winner() + BOX_MBR via Payment.
        Box is deleted after refund (as idempotency guard).

        Kill-the-mutant target: remove the elapsed >= REFUND_WINDOW_ROUNDS assert
        in refund() and confirm this test catches early refund.
        """
        # TODO: flip(), advance rounds by REFUND_WINDOW_ROUNDS + 1.
        # Call refund() as PLAYER_ADDRESS.
        # Verify inner ApplicationCall to treasury with bet_amount.
        # Verify inner Payment of BOX_MBR to player.
        # Verify box is deleted.
        pytest.skip("TODO")

    def test_refund_reverts_before_48h(self, coinflip_context: object) -> None:
        """
        refund() must revert when elapsed < REFUND_WINDOW_ROUNDS.

        This prevents players from refunding before giving the keeper time to resolve.

        Kill-the-mutant target: remove the elapsed >= REFUND_WINDOW_ROUNDS assert
        in refund() and confirm this test detects the missing guard.
        """
        # TODO: flip(), advance rounds by REFUND_WINDOW_ROUNDS - 1.
        # Verify refund() raises "48h refund window has not elapsed".
        pytest.skip("TODO")

    def test_refund_only_callable_by_player(self, coinflip_context: object) -> None:
        """
        refund() can only be called by the player whose flip it is.

        Unlike resolve(), refund() is not permissionless -- it requires Txn.sender
        to match the box key (player address).
        """
        # TODO: flip as PLAYER_ADDRESS, attempt refund as PLAYER2_ADDRESS.
        # Verify raises "no active flip for this address" (box lookup fails for PLAYER2).
        pytest.skip("TODO")

    def test_refund_reverts_with_no_active_flip(self, coinflip_context: object) -> None:
        """refund() reverts when no box exists for the sender."""
        # TODO: call refund() with no prior flip. Verify raises "no active flip".
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# Admin operations
# ---------------------------------------------------------------------------

class TestAdmin:
    def test_non_admin_cannot_pause(self, coinflip_context: object) -> None:
        """set_paused() reverts when called by non-admin."""
        # TODO: ctx.set_sender(PLAYER_ADDRESS), contract.set_paused(True)
        # Verify raises "sender is not admin".
        pytest.skip("TODO")

    def test_admin_can_pause_and_unpause(self, coinflip_context: object) -> None:
        """Admin can toggle pause state; paused flag reflects correctly."""
        # TODO: pause, assert paused == 1; unpause, assert paused == 0.
        pytest.skip("TODO")

    def test_set_min_bet_enforces_order(self, coinflip_context: object) -> None:
        """set_min_bet() reverts when new min_bet > max_bet."""
        # TODO: attempt set_min_bet(MAX_BET + 1). Verify raises constraint error.
        pytest.skip("TODO")

    def test_set_max_bet_enforces_order(self, coinflip_context: object) -> None:
        """set_max_bet() reverts when new max_bet < min_bet."""
        pytest.skip("TODO")

    def test_set_leaderboard_app_id_zero_disables(self, coinflip_context: object) -> None:
        """set_leaderboard_app_id(0) disables leaderboard inner calls."""
        pytest.skip("TODO")

    def test_set_beacon_app_id_overrides_for_localnet(self, coinflip_context: object) -> None:
        """set_beacon_app_id() updates beacon_app_id global state."""
        # TODO: set new beacon app ID, verify global state updated.
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# Jackpot hook (v1 disabled -- bps == 0)
# ---------------------------------------------------------------------------

class TestJackpot:
    def test_jackpot_disabled_at_deploy(self, coinflip_context: object) -> None:
        """jackpot_bps == 0 at deploy time. No jackpot logic executes on resolve."""
        # TODO: verify jackpot_bps.value == 0 after create().
        pytest.skip("TODO")

    def test_jackpot_bps_zero_means_no_jackpot_on_win(self, coinflip_context: object) -> None:
        """
        When jackpot_bps == 0, a winning flip does not trigger jackpot checks.

        Verify: jackpot_balance does not change on win when bps == 0.
        """
        # TODO: win a flip, assert jackpot_balance.value == 0 (unchanged).
        pytest.skip("TODO")

    def test_jackpot_bps_ceiling_enforcement(self, coinflip_context: object) -> None:
        """set_jackpot_bps() reverts when bps > 500 (5%)."""
        # TODO: ctx.set_sender(ADMIN_ADDRESS); contract.set_jackpot_bps(501, 1000)
        # Verify raises "jackpot_bps cannot exceed 5%".
        pytest.skip("TODO")

    def test_jackpot_win_odds_must_be_positive(self, coinflip_context: object) -> None:
        """set_jackpot_bps() reverts when win_odds == 0 (would cause div-by-zero)."""
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# Leaderboard integration
# ---------------------------------------------------------------------------

class TestLeaderboard:
    def test_resolve_calls_leaderboard_when_enabled(self, coinflip_context: object) -> None:
        """
        When leaderboard_app_id > 0, resolve() emits an inner app call to
        leaderboard.record_result(player, won, bet, payout, jackpot_hit=False).

        Verify the inner call is emitted with correct arguments.

        Note: leaderboard inner call is currently TODO(FG-001) in resolve().
        Uncomment the leaderboard block in resolve() and implement this test.
        """
        # TODO: set_leaderboard_app_id(LEADERBOARD_APP_ID), mock the leaderboard app,
        # resolve a flip, verify inner app call arguments.
        pytest.skip("TODO: requires FG-001 leaderboard integration to be implemented")

    def test_resolve_skips_leaderboard_when_disabled(self, coinflip_context: object) -> None:
        """When leaderboard_app_id == 0, resolve() emits no leaderboard inner call."""
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# Read-only views
# ---------------------------------------------------------------------------

class TestViews:
    def test_get_flip_state_returns_stored_state(self, coinflip_context: object) -> None:
        """get_flip_state() returns the same FlipState written by flip()."""
        # TODO: flip(), then get_flip_state(PLAYER_ADDRESS) and compare fields.
        # Also verify state.referrer == ZERO_ADDRESS when no referrer passed.
        pytest.skip("TODO")

    def test_get_flip_state_reverts_when_no_flip(self, coinflip_context: object) -> None:
        """get_flip_state() reverts when no box exists for the address."""
        # TODO: call get_flip_state(PLAYER_ADDRESS) with no prior flip.
        # Verify raises "no active flip for player".
        pytest.skip("TODO")

    def test_has_active_flip_returns_false_before_flip(self, coinflip_context: object) -> None:
        """has_active_flip() returns False for an address with no active flip."""
        pytest.skip("TODO")

    def test_has_active_flip_returns_true_after_flip(self, coinflip_context: object) -> None:
        """has_active_flip() returns True after flip() and False after resolve()."""
        pytest.skip("TODO")


# ---------------------------------------------------------------------------
# LocalNet integration tests (require AlgoKit LocalNet)
# ---------------------------------------------------------------------------

@pytest.mark.localnet
class TestCoinflipLocalNet:
    """
    End-to-end integration tests against a running AlgoKit LocalNet.

    Run with: LOCALNET=1 python -m pytest tests/test_coinflip.py -m localnet -v

    These tests require:
        - AlgoKit LocalNet running (algokit localnet start)
        - HouseTreasury deployed and funded
        - CoinflipContract deployed and registered with treasury
        - VRF beacon stub deployed on LocalNet

    TODO: implement using algokit_utils.AlgorandClient and generated TypeScript clients.
    """

    def test_full_flip_and_win_e2e(self) -> None:
        """
        Full end-to-end test:
        1. Player submits 2-txn group: payment (bet + BOX_MBR) + flip() app call.
        2. Advance LocalNet to commit_round + BEACON_SETTLE_BUFFER.
        3. Keeper calls resolve(player).
        4. Verify payout received by player address (net = 980_000 microALGO).
        5. Verify box deleted (no state leakage).
        6. Verify treasury total_paid_out incremented.
        """
        pytest.skip("TODO: implement LocalNet E2E test")

    def test_full_refund_e2e(self) -> None:
        """
        Full end-to-end refund test:
        1. Player submits flip().
        2. Advance LocalNet by REFUND_WINDOW_ROUNDS + 1 without resolving.
        3. Player calls refund().
        4. Verify bet returned to player via treasury.
        5. Verify BOX_MBR returned to player via direct Payment.
        6. Verify box deleted.
        """
        pytest.skip("TODO: implement LocalNet refund E2E test")
