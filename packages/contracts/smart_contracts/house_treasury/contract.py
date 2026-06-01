"""
HouseTreasury -- Fairground shared liquidity pool (the bankroll for every game).

Capital model (decided 2026-06-01, see docs/audit/scaffold-meta-audit-2026-06-01.md):
each game escrows the player's stake in its own contract during the pending window.
On resolve() the game sweeps the stake into this treasury (an inner payment to the
treasury address) and, on a win, calls pay_winner() here. The treasury is therefore
the single bankroll: losing stakes flow in, winning payouts flow out, and the 2%
house edge accrues here.

Refunds are paid by the game contract from its own retained balance and never touch
the treasury -- so the 48h player refund backdoor keeps working even when the
treasury is emergency-paused.

Solvency invariant: payout <= max_payout_bps * spendable / 10000 at resolve() time,
where spendable = live_balance - min_balance (excludes non-spendable MBR).

Game registry BoxMap:
    key_prefix=b"game:", key_type=arc4.Address (32 bytes on-chain, no ARC-4 length prefix)
    on-chain key = 5 (prefix) + 32 (address) = 37 bytes; value = 8 bytes
    MBR per entry = 2500 + 400*(37+8) = 20,500 microALGO (charged to the caller of register_game)
"""

import typing

from algopy import (
    ARC4Contract,
    GlobalState,
    BoxMap,
    UInt64,
    Account,
    Txn,
    Global,
    gtxn,
    itxn,
    op,
    subroutine,
    arc4,
)

# Module constants are plain Final literals -- puyapy does not accept module-level
# UInt64(...) instances as compile-time constants. Wrap with UInt64() at the use site.
DEFAULT_MAX_PAYOUT_BPS: typing.Final = 100      # 1% of spendable balance
MAX_PAYOUT_BPS_CEILING: typing.Final = 1_000    # 10% hard cap on the admin setter
BPS_DENOMINATOR: typing.Final = 10_000
REGISTERED_FLAG: typing.Final = 1
GAME_BOX_MBR: typing.Final = 20_500             # 2500 + 400*(37+8)
# ~48h at 2.8s/block: 48 * 3600 / 2.8 ~= 61,714 rounds
EMERGENCY_TIMELOCK_ROUNDS: typing.Final = 61_714


class HouseTreasury(ARC4Contract):
    """Shared liquidity pool for all Fairground games."""

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.max_payout_bps = GlobalState(UInt64)
        self.paused = GlobalState(UInt64)
        self.total_deposited = GlobalState(UInt64)
        self.total_paid_out = GlobalState(UInt64)
        self.withdraw_request_round = GlobalState(UInt64)
        # arc4.Address key: 32 bytes on-chain (no ARC-4 length prefix, unlike a Bytes key)
        self.registered_games = BoxMap(arc4.Address, UInt64, key_prefix=b"game:")

    @arc4.abimethod(create="require")
    def create(self, admin: arc4.Address) -> None:
        """Deploy HouseTreasury."""
        self.admin.value = admin.native
        self.max_payout_bps.value = UInt64(DEFAULT_MAX_PAYOUT_BPS)
        self.paused.value = UInt64(0)
        self.total_deposited.value = UInt64(0)
        self.total_paid_out.value = UInt64(0)
        self.withdraw_request_round.value = UInt64(0)

    @arc4.abimethod
    def set_admin(self, new_admin: arc4.Address) -> None:
        """Transfer admin rights. Current admin only."""
        self._require_admin()
        self.admin.value = new_admin.native

    @arc4.abimethod
    def set_max_payout_bps(self, bps: arc4.UInt64) -> None:
        """Update the max-payout ceiling (bps). Hard cap 1000 = 10%. Admin only."""
        self._require_admin()
        assert bps.native > UInt64(0), "max_payout_bps must be positive"
        assert bps.native <= UInt64(MAX_PAYOUT_BPS_CEILING), "max_payout_bps cannot exceed 1000 (10%)"
        self.max_payout_bps.value = bps.native

    @arc4.abimethod
    def pause(self) -> None:
        """Halt all game payouts. Admin only."""
        self._require_admin()
        self.paused.value = UInt64(1)

    @arc4.abimethod
    def unpause(self) -> None:
        """Resume payouts. Admin only."""
        self._require_admin()
        self.paused.value = UInt64(0)

    @arc4.abimethod
    def register_game(self, game_app_id: arc4.UInt64, pay: gtxn.PaymentTransaction) -> None:
        """
        Authorize a game contract to call pay_winner(). Admin only.

        Stores by app address (arc4.Address key), not app ID. The caller must
        include a grouped payment covering the registry box MBR (20,500 microALGO).
        """
        self._require_admin()
        assert pay.receiver == Global.current_application_address, "MBR payment must go to treasury"
        assert pay.amount >= UInt64(GAME_BOX_MBR), "insufficient MBR payment for game registry box"
        game_addr, exists = op.AppParamsGet.app_address(game_app_id.native)
        assert exists, "game_app_id does not exist"
        self.registered_games[arc4.Address(game_addr.bytes)] = UInt64(REGISTERED_FLAG)

    @arc4.abimethod
    def deregister_game(self, game_app_id: arc4.UInt64) -> None:
        """Remove a game contract from the registry. Admin only."""
        self._require_admin()
        game_addr, exists = op.AppParamsGet.app_address(game_app_id.native)
        assert exists, "game_app_id does not exist"
        del self.registered_games[arc4.Address(game_addr.bytes)]

    @arc4.abimethod
    def deposit(self, pay: gtxn.PaymentTransaction) -> None:
        """Accept a top-up into the bankroll (admin seeding or manual reserve)."""
        assert pay.receiver == Global.current_application_address, "payment must go to treasury"
        self.total_deposited.value = self.total_deposited.value + pay.amount

    @arc4.abimethod
    def pay_winner(self, winner: arc4.Address, amount: arc4.UInt64) -> None:
        """
        Pay a game winner. Only callable -- as an inner app call -- by a registered
        game contract. Enforces the solvency ceiling against the LIVE spendable
        balance at call time.
        """
        assert self.paused.value == UInt64(0), "treasury is paused"

        # The caller is the game CONTRACT (Txn.sender == game app address).
        flag, is_registered = self.registered_games.maybe(arc4.Address(Txn.sender.bytes))
        assert is_registered, "caller is not a registered game"
        assert flag == UInt64(REGISTERED_FLAG), "invalid registration flag"

        app = Global.current_application_address
        spendable = app.balance - app.min_balance
        max_payout = spendable * self.max_payout_bps.value // UInt64(BPS_DENOMINATOR)
        payout = amount.native
        assert payout > UInt64(0), "payout must be positive"
        assert payout <= max_payout, "payout exceeds max_payout_bps of spendable balance"

        itxn.Payment(receiver=winner.native, amount=payout, fee=UInt64(0)).submit()
        self.total_paid_out.value = self.total_paid_out.value + payout

    @arc4.abimethod(readonly=True)
    def get_available_balance(self) -> arc4.UInt64:
        """Spendable balance (total minus min_balance). Read via simulate() before a bet."""
        app = Global.current_application_address
        if app.balance > app.min_balance:
            return arc4.UInt64(app.balance - app.min_balance)
        return arc4.UInt64(UInt64(0))

    @arc4.abimethod(readonly=True)
    def is_paused(self) -> arc4.Bool:
        return arc4.Bool(self.paused.value == UInt64(1))

    @arc4.abimethod(readonly=True)
    def get_max_payout_bps(self) -> arc4.UInt64:
        return arc4.UInt64(self.max_payout_bps.value)

    @arc4.abimethod(readonly=True)
    def is_game_registered(self, game_app_id: arc4.UInt64) -> arc4.Bool:
        game_addr, exists = op.AppParamsGet.app_address(game_app_id.native)
        if not exists:
            return arc4.Bool(False)
        flag, in_map = self.registered_games.maybe(arc4.Address(game_addr.bytes))
        return arc4.Bool(in_map)

    @arc4.abimethod
    def request_emergency_withdraw(self) -> None:
        """Start the 48h timelock for an emergency withdrawal. Admin only; requires pause first."""
        self._require_admin()
        assert self.paused.value == UInt64(1), "must pause before requesting withdrawal"
        self.withdraw_request_round.value = Global.round

    @arc4.abimethod
    def emergency_withdraw(self, amount: arc4.UInt64) -> None:
        """
        Withdraw ALGO to admin after the 48h timelock. Admin only; requires pause
        and a prior request_emergency_withdraw(). The timelock prevents an instant
        drain on admin-key compromise.
        """
        self._require_admin()
        assert self.paused.value == UInt64(1), "must pause before emergency withdrawal"
        assert self.withdraw_request_round.value > UInt64(0), "no withdrawal requested"
        assert (
            Global.round >= self.withdraw_request_round.value + UInt64(EMERGENCY_TIMELOCK_ROUNDS)
        ), "48h timelock has not elapsed"
        itxn.Payment(receiver=self.admin.value, amount=amount.native, fee=UInt64(0)).submit()
        self.withdraw_request_round.value = UInt64(0)

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin.value, "sender is not admin"
