"""
HouseTreasury -- Fairground shared liquidity pool.

All game contracts call get_available_balance() and pay_winner() here.
Only registered game contracts (stored by app address in BoxMap) may call pay_winner().

Solvency invariant: payout <= max_payout_bps * spendable_balance / 10000 at resolve time.
spendable_balance = live_balance - min_balance (excludes non-spendable MBR).

Game registry BoxMap:
    key_prefix=b"game:", key_type=arc4.Address (32 bytes, no ARC-4 length prefix)
    on-chain key = 5 (prefix) + 32 (address) = 37 bytes; value = 8 bytes
    MBR per entry = 2500 + 400*(37+8) = 2500 + 18000 = 20500 microALGO
"""

from algopy import (
    ARC4Contract,
    GlobalState,
    BoxMap,
    UInt64,
    Account,
    Txn,
    Global,
    itxn,
    gtxn,
    op,
    subroutine,
    arc4,
)


DEFAULT_MAX_PAYOUT_BPS: UInt64 = UInt64(100)   # 1% of spendable balance
BPS_DENOMINATOR: UInt64 = UInt64(10_000)
REGISTERED_FLAG: UInt64 = UInt64(1)


class HouseTreasury(ARC4Contract):
    """
    Shared liquidity pool for all Fairground games.

    Global state: admin, max_payout_bps, paused, total_deposited, total_paid_out.

    Box storage (registered_games):
        key_type=arc4.Address (32 bytes on-chain, no ARC-4 length prefix)
        key_prefix=b"game:" (5 bytes)
        MBR per entry = 2500 + 400*(37+8) = 20500 microALGO
    """

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.max_payout_bps = GlobalState(UInt64)
        self.paused = GlobalState(UInt64)
        self.total_deposited = GlobalState(UInt64)
        self.total_paid_out = GlobalState(UInt64)
        # arc4.Address key: 32 bytes on-chain (no ARC-4 length prefix, unlike Bytes key)
        self.registered_games = BoxMap(arc4.Address, UInt64, key_prefix=b"game:")

    @arc4.abimethod(create="require")
    def create(self, admin: arc4.Address) -> None:
        """Deploy HouseTreasury."""
        self.admin.value = admin.native
        self.max_payout_bps.value = DEFAULT_MAX_PAYOUT_BPS
        self.paused.value = UInt64(0)
        self.total_deposited.value = UInt64(0)
        self.total_paid_out.value = UInt64(0)

    @arc4.abimethod
    def set_admin(self, new_admin: arc4.Address) -> None:
        """Transfer admin rights. Current admin only."""
        self._require_admin()
        self.admin.value = new_admin.native

    @arc4.abimethod
    def set_max_payout_bps(self, bps: arc4.UInt64) -> None:
        """Update max-payout ceiling (bps). Hard cap 1000 = 10%. Admin only."""
        self._require_admin()
        assert bps.native <= UInt64(1000), "max_payout_bps cannot exceed 1000 (10%)"
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
    def register_game(self, game_app_id: arc4.UInt64) -> None:
        """
        Authorize a game contract to call pay_winner().

        Stores by app address (arc4.Address key) not app ID.
        Caller must include payment covering MBR: 20500 microALGO.
        TODO: enforce MBR payment as a gtxn check.

        Args:
            game_app_id: On-chain application ID of the game contract.
        """
        self._require_admin()
        game_addr_raw, exists = op.AppParamsGet.app_address(game_app_id.native)
        assert exists, "game_app_id does not exist"
        game_key = arc4.Address(game_addr_raw.bytes)
        self.registered_games[game_key] = REGISTERED_FLAG

    @arc4.abimethod
    def deregister_game(self, game_app_id: arc4.UInt64) -> None:
        """Remove a game contract from the registry. Admin only."""
        self._require_admin()
        game_addr_raw, exists = op.AppParamsGet.app_address(game_app_id.native)
        assert exists, "game_app_id does not exist"
        game_key = arc4.Address(game_addr_raw.bytes)
        del self.registered_games[game_key]

    @arc4.abimethod
    def deposit(self, pay: gtxn.PaymentTransaction) -> None:
        """
        Accept a payment into the treasury pool.

        Args:
            pay: Payment transaction in the same atomic group.
        """
        assert pay.receiver == Global.current_application_address, "payment must go to treasury"
        self.total_deposited.value = self.total_deposited.value + pay.amount

    @arc4.abimethod
    def pay_winner(
        self,
        winner: arc4.Address,
        amount_microalgo: arc4.UInt64,
    ) -> None:
        """
        Send ALGO to a game winner. Only callable by registered game contracts.

        Called as an inner app call from game contract resolve().
        Enforces solvency: payout <= max_payout_bps% of spendable balance.

        Args:
            winner:           Winning player's address.
            amount_microalgo: Payout amount in microALGO.
        """
        assert self.paused.value == UInt64(0), "treasury is paused"

        # Verify caller is a registered game contract via BoxMap abstraction
        # BoxMap.maybe(key) returns (value, exists); check exists first, then value
        caller_key = arc4.Address(Txn.sender.bytes)
        flag, is_registered = self.registered_games.maybe(caller_key)
        assert is_registered, "caller not registered game"
        assert flag == REGISTERED_FLAG, "invalid registration flag"

        # Solvency check against spendable balance (excludes non-spendable MBR)
        app_account = Global.current_application_address
        live_balance = app_account.balance
        spendable = live_balance - app_account.min_balance
        max_payout = spendable * self.max_payout_bps.value // BPS_DENOMINATOR
        payout = amount_microalgo.native
        assert payout <= max_payout, "payout exceeds max_payout_bps of spendable balance"
        assert payout < spendable, "payout exceeds spendable balance"
        assert payout > UInt64(0), "payout must be positive"

        itxn.Payment(
            receiver=winner.native,
            amount=payout,
            fee=UInt64(0),
        ).submit()

        self.total_paid_out.value = self.total_paid_out.value + payout

    @arc4.abimethod(readonly=True)
    def get_available_balance(self) -> arc4.UInt64:
        """
        Return spendable balance (total minus min_balance).

        Used via simulate() in keeper and frontend to check solvency before bet.
        """
        app_account = Global.current_application_address
        balance = app_account.balance
        min_balance = app_account.min_balance
        if balance > min_balance:
            return arc4.UInt64(balance - min_balance)
        return arc4.UInt64(UInt64(0))

    @arc4.abimethod(readonly=True)
    def is_paused(self) -> arc4.Bool:
        """Return True if emergency pause is active."""
        return arc4.Bool(self.paused.value == UInt64(1))

    @arc4.abimethod(readonly=True)
    def get_max_payout_bps(self) -> arc4.UInt64:
        """Return the current max payout ceiling in basis points."""
        return arc4.UInt64(self.max_payout_bps.value)

    @arc4.abimethod(readonly=True)
    def is_game_registered(self, game_app_id: arc4.UInt64) -> arc4.Bool:
        """Check whether a game contract is registered."""
        game_addr_raw, exists = op.AppParamsGet.app_address(game_app_id.native)
        if not exists:
            return arc4.Bool(False)
        game_key = arc4.Address(game_addr_raw.bytes)
        # BoxMap.maybe(key) returns (value, exists)
        _, in_map = self.registered_games.maybe(game_key)
        return arc4.Bool(in_map)

    @arc4.abimethod
    def emergency_withdraw(self, amount: arc4.UInt64) -> None:
        """
        Withdraw ALGO to admin. Emergency only. Requires paused == 1.
        TODO: add 48h timelock before mainnet.
        """
        self._require_admin()
        assert self.paused.value == UInt64(1), "must pause before emergency withdrawal"
        itxn.Payment(
            receiver=self.admin.value,
            amount=amount.native,
            fee=UInt64(0),
        ).submit()

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin.value, "sender is not admin"
