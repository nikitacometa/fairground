"""
LeaderboardContract -- cross-game per-wallet stats.

Called by game contracts via inner app call after every bet resolution.

Box storage (stats):
    key_prefix=b"stats:", key_type=arc4.Address (32 bytes, no ARC-4 length prefix)
    on-chain key = 6 (prefix) + 32 = 38 bytes
    value = WalletStats struct: 8 fields * 8 bytes = 64 bytes
    MBR = 2500 + 400*(38+64) = 2500 + 40800 = 43300 microALGO

Box storage (registered_callers):
    key_prefix=b"caller:", key_type=arc4.Address (32 bytes)
    on-chain key = 7 + 32 = 39 bytes; value = 8 bytes
    MBR = 2500 + 400*(39+8) = 2500 + 18800 = 21300 microALGO

Note: arc4.Int64 does not exist in algopy 3.5.0 -- only unsigned arc4 types exist.
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
    op,
    subroutine,
    arc4,
)


REGISTERED_CALLER_FLAG: UInt64 = UInt64(1)


class WalletStats(arc4.Struct):
    """
    Per-wallet leaderboard stats. 64 bytes total (8 fields * 8 bytes).
    net_pnl computed off-chain as wins_amount - losses_amount.
    """
    wins: arc4.UInt64
    losses: arc4.UInt64
    total_volume: arc4.UInt64     # cumulative microALGO bet
    jackpot_hits: arc4.UInt64
    last_round: arc4.UInt64
    game_count: arc4.UInt64
    wins_amount: arc4.UInt64      # cumulative microALGO won (payouts received)
    losses_amount: arc4.UInt64    # cumulative microALGO lost (bets not returned)


class LeaderboardContract(ARC4Contract):
    """Cross-game leaderboard. Called via inner app call after every resolution."""

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.total_wallets = GlobalState(UInt64)
        # arc4.Address key: 32 bytes on-chain, no ARC-4 length prefix
        self.registered_callers = BoxMap(arc4.Address, UInt64, key_prefix=b"caller:")
        self.stats = BoxMap(arc4.Address, WalletStats, key_prefix=b"stats:")

    @arc4.abimethod(create="require")
    def create(self, admin: arc4.Address) -> None:
        """Deploy LeaderboardContract."""
        self.admin.value = admin.native
        self.total_wallets.value = UInt64(0)

    @arc4.abimethod
    def register_caller(self, game_app_id: arc4.UInt64) -> None:
        """
        Authorize a game contract to call record_result().
        Caller must include MBR payment: 21300 microALGO.

        Args:
            game_app_id: On-chain application ID to authorize.
        """
        self._require_admin()
        game_addr_raw, exists = op.AppParamsGet.app_address(game_app_id.native)
        assert exists, "game_app_id does not exist on-chain"
        game_key = arc4.Address(game_addr_raw.bytes)
        self.registered_callers[game_key] = REGISTERED_CALLER_FLAG

    @arc4.abimethod
    def deregister_caller(self, game_app_id: arc4.UInt64) -> None:
        """Remove a game contract from authorized callers. Admin only."""
        self._require_admin()
        game_addr_raw, exists = op.AppParamsGet.app_address(game_app_id.native)
        assert exists, "game_app_id does not exist"
        game_key = arc4.Address(game_addr_raw.bytes)
        del self.registered_callers[game_key]

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
        Record a bet resolution. Called by registered game contracts.

        For new players: creates a WalletStats box. Caller must fund MBR (43300 microALGO).
        For existing players: updates the box in place.

        Args:
            player:      Player address.
            won:         True if player won.
            bet_amount:  Bet in microALGO.
            payout:      Amount paid out (0 if lost).
            jackpot_hit: True if jackpot was also won.
        """
        # BoxMap.maybe(key) returns (value, exists); check exists first, then value
        caller_key = arc4.Address(Txn.sender.bytes)
        flag, is_registered = self.registered_callers.maybe(caller_key)
        assert is_registered, "caller not registered"
        assert flag == REGISTERED_CALLER_FLAG, "invalid caller registration flag"

        existing_stats, exists = self.stats.maybe(player)

        if exists:
            updated = WalletStats(
                wins=arc4.UInt64(
                    existing_stats.wins.native + (UInt64(1) if won.native else UInt64(0))
                ),
                losses=arc4.UInt64(
                    existing_stats.losses.native + (UInt64(0) if won.native else UInt64(1))
                ),
                total_volume=arc4.UInt64(existing_stats.total_volume.native + bet_amount.native),
                jackpot_hits=arc4.UInt64(
                    existing_stats.jackpot_hits.native
                    + (UInt64(1) if jackpot_hit.native else UInt64(0))
                ),
                last_round=arc4.UInt64(Global.round),
                game_count=arc4.UInt64(existing_stats.game_count.native + UInt64(1)),
                wins_amount=arc4.UInt64(
                    existing_stats.wins_amount.native
                    + (payout.native if won.native else UInt64(0))
                ),
                losses_amount=arc4.UInt64(
                    existing_stats.losses_amount.native
                    + (UInt64(0) if won.native else bet_amount.native)
                ),
            )
            self.stats[player] = updated
        else:
            # New player -- caller must have funded MBR in this group
            # TODO: enforce gtxn MBR payment for new box
            self.stats[player] = WalletStats(
                wins=arc4.UInt64(UInt64(1) if won.native else UInt64(0)),
                losses=arc4.UInt64(UInt64(0) if won.native else UInt64(1)),
                total_volume=arc4.UInt64(bet_amount.native),
                jackpot_hits=arc4.UInt64(UInt64(1) if jackpot_hit.native else UInt64(0)),
                last_round=arc4.UInt64(Global.round),
                game_count=arc4.UInt64(UInt64(1)),
                wins_amount=arc4.UInt64(payout.native if won.native else UInt64(0)),
                losses_amount=arc4.UInt64(UInt64(0) if won.native else bet_amount.native),
            )
            self.total_wallets.value = self.total_wallets.value + UInt64(1)

    @arc4.abimethod(readonly=True)
    def get_stats(self, player: arc4.Address) -> WalletStats:
        """Return leaderboard stats for a player. Raises if never played."""
        stats, exists = self.stats.maybe(player)
        assert exists, "no stats for this address"
        return stats.copy()

    @arc4.abimethod(readonly=True)
    def get_total_wallets(self) -> arc4.UInt64:
        """Return total unique wallets ever recorded."""
        return arc4.UInt64(self.total_wallets.value)

    @arc4.abimethod
    def set_admin(self, new_admin: arc4.Address) -> None:
        """Transfer admin. Current admin only."""
        self._require_admin()
        self.admin.value = new_admin.native

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin.value, "sender is not admin"
