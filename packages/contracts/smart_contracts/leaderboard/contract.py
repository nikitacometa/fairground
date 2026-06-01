"""
LeaderboardContract -- cross-game per-wallet stats (Phase 2; not wired into
CometaFlip v1, which tracks stats off-chain in Postgres/Redis).

Game contracts call record_result() via inner app call after every resolution.
Kept compiling and correct so game #2 can wire it in without a rewrite.

Box storage (stats):
    key_prefix=b"stats:", key_type=arc4.Address -> on-chain key = 6 + 32 = 38 bytes
    value = WalletStats: 8 fields * 8 bytes = 64 bytes
    MBR = 2500 + 400*(38+64) = 43,300 microALGO

Box storage (registered_callers):
    key_prefix=b"caller:", key_type=arc4.Address -> on-chain key = 7 + 32 = 39 bytes
    value = 8 bytes; MBR = 2500 + 400*(39+8) = 21,300 microALGO

Note: arc4.Int64 does not exist in algopy 3.5.0 -- only unsigned arc4 types.
Net PnL is split into wins_amount + losses_amount; net = wins - losses off-chain.
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
    op,
    subroutine,
    arc4,
)

REGISTERED_CALLER_FLAG: typing.Final = 1
CALLER_BOX_MBR: typing.Final = 21_300   # 2500 + 400*(39+8)


class WalletStats(arc4.Struct):
    """Per-wallet leaderboard stats. 64 bytes (8 fields * 8 bytes)."""

    wins: arc4.UInt64
    losses: arc4.UInt64
    total_volume: arc4.UInt64
    jackpot_hits: arc4.UInt64
    last_round: arc4.UInt64
    game_count: arc4.UInt64
    wins_amount: arc4.UInt64       # cumulative microALGO won
    losses_amount: arc4.UInt64     # cumulative microALGO lost


class LeaderboardContract(ARC4Contract):
    """Cross-game leaderboard. Called via inner app call after every resolution."""

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.total_wallets = GlobalState(UInt64)
        self.registered_callers = BoxMap(arc4.Address, UInt64, key_prefix=b"caller:")
        self.stats = BoxMap(arc4.Address, WalletStats, key_prefix=b"stats:")

    @arc4.abimethod(create="require")
    def create(self, admin: arc4.Address) -> None:
        """Deploy LeaderboardContract."""
        self.admin.value = admin.native
        self.total_wallets.value = UInt64(0)

    @arc4.abimethod
    def register_caller(self, game_app_id: arc4.UInt64, pay: gtxn.PaymentTransaction) -> None:
        """
        Authorize a game contract to call record_result(). Admin only.
        Requires a grouped payment covering the caller-registry box MBR (21,300 microALGO).
        """
        self._require_admin()
        assert pay.receiver == Global.current_application_address, "MBR payment must go to leaderboard"
        assert pay.amount >= UInt64(CALLER_BOX_MBR), "insufficient MBR payment for caller box"
        game_addr, exists = op.AppParamsGet.app_address(game_app_id.native)
        assert exists, "game_app_id does not exist on-chain"
        self.registered_callers[arc4.Address(game_addr.bytes)] = UInt64(REGISTERED_CALLER_FLAG)

    @arc4.abimethod
    def deregister_caller(self, game_app_id: arc4.UInt64) -> None:
        """Remove a game contract from authorized callers. Admin only."""
        self._require_admin()
        game_addr, exists = op.AppParamsGet.app_address(game_app_id.native)
        assert exists, "game_app_id does not exist"
        del self.registered_callers[arc4.Address(game_addr.bytes)]

    @arc4.abimethod
    def record_result(
        self,
        player: arc4.Address,
        won: arc4.Bool,
        bet_amount: arc4.UInt64,
        payout: arc4.UInt64,
        jackpot_hit: arc4.Bool,
    ) -> None:
        """
        Record a bet resolution. Called by a registered game contract. For a new
        player the calling group must pre-fund the stats box MBR (43,300 microALGO).
        """
        flag, is_registered = self.registered_callers.maybe(arc4.Address(Txn.sender.bytes))
        assert is_registered, "caller is not registered"
        assert flag == UInt64(REGISTERED_CALLER_FLAG), "invalid caller registration flag"

        win_inc = UInt64(1) if won.native else UInt64(0)
        loss_inc = UInt64(0) if won.native else UInt64(1)
        won_amount = payout.native if won.native else UInt64(0)
        lost_amount = UInt64(0) if won.native else bet_amount.native
        jackpot_inc = UInt64(1) if jackpot_hit.native else UInt64(0)

        # Struct-valued BoxMap: use `in` + indexed .copy() (maybe() cannot be bound/unpacked).
        if player in self.stats:
            prev = self.stats[player].copy()
            self.stats[player] = WalletStats(
                wins=arc4.UInt64(prev.wins.native + win_inc),
                losses=arc4.UInt64(prev.losses.native + loss_inc),
                total_volume=arc4.UInt64(prev.total_volume.native + bet_amount.native),
                jackpot_hits=arc4.UInt64(prev.jackpot_hits.native + jackpot_inc),
                last_round=arc4.UInt64(Global.round),
                game_count=arc4.UInt64(prev.game_count.native + UInt64(1)),
                wins_amount=arc4.UInt64(prev.wins_amount.native + won_amount),
                losses_amount=arc4.UInt64(prev.losses_amount.native + lost_amount),
            )
        else:
            self.stats[player] = WalletStats(
                wins=arc4.UInt64(win_inc),
                losses=arc4.UInt64(loss_inc),
                total_volume=arc4.UInt64(bet_amount.native),
                jackpot_hits=arc4.UInt64(jackpot_inc),
                last_round=arc4.UInt64(Global.round),
                game_count=arc4.UInt64(UInt64(1)),
                wins_amount=arc4.UInt64(won_amount),
                losses_amount=arc4.UInt64(lost_amount),
            )
            self.total_wallets.value = self.total_wallets.value + UInt64(1)

    @arc4.abimethod(readonly=True)
    def get_stats(self, player: arc4.Address) -> WalletStats:
        """Return leaderboard stats for a player. Raises if never played."""
        assert player in self.stats, "no stats for this address"
        return self.stats[player].copy()

    @arc4.abimethod(readonly=True)
    def get_total_wallets(self) -> arc4.UInt64:
        return arc4.UInt64(self.total_wallets.value)

    @arc4.abimethod
    def set_admin(self, new_admin: arc4.Address) -> None:
        """Transfer admin. Current admin only."""
        self._require_admin()
        self.admin.value = new_admin.native

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin.value, "sender is not admin"
