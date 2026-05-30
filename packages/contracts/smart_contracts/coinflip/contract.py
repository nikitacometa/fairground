"""
CoinflipContract -- CometaFlip v1.

Game flow:
    1. Player submits a group of 2 transactions:
           Txn 0: payment to contract (bet amount + box MBR)
           Txn 1: app call to flip(pay, salt_hash, referrer)
       flip() receives the payment as an ABI method parameter (gtxn.PaymentTransaction).
       flip() commits to VRF beacon round = current_round + BEACON_DELAY.

    2. After commit_round + BEACON_SETTLE_BUFFER passes, anyone calls resolve(player_address).
       resolve() reads the VRF beacon output via arc4.abi_call to Applied Blockchain beacon.
       Outcome: sha256(beacon_output_32_bytes || salt_hash)[0] % 2 -- 0=loss, 1=win.
       On win: inner app call to HouseTreasury.pay_winner().
       On win with referrer: referral_amount = bet * REFERRAL_BPS // BPS_DENOMINATOR paid out.
       Box deleted LAST -- non-existence is the idempotency guard.

    3. 48h refund backdoor: player calls refund() if keeper never resolved.

VRF beacon (Applied Blockchain):
    Mainnet app ID: 947957720 (confirmed live 2026-05-30).
    Testnet app ID: 110096026.
    ABI method: must_get(uint64,byte[])byte[] -- panics if round not stored (correct).
    Beacon stores last 189 outputs (~70 min). Keeper SLA: resolve within 60 min.

Box storage:
    BoxMap key_prefix=b"flip:", key_type=arc4.Address (32 bytes, no ARC-4 length prefix)
    on-chain key = 5 (prefix) + 32 (address) = 37 bytes
    value = FlipState: vrf_round(8) + bet_amount(8) + salt_hash(32) + claimed(1) + referrer(32) = 81 bytes
    MBR = 2500 + 400 * (37 + 81) = 2500 + 47200 = 49700 microALGO
"""

import typing

import algopy
from algopy import (
    ARC4Contract,
    GlobalState,
    BoxMap,
    Bytes,
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


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BEACON_DELAY: UInt64 = UInt64(8)
BEACON_SETTLE_BUFFER: UInt64 = UInt64(2)
HOUSE_EDGE_BPS: UInt64 = UInt64(200)
REFERRAL_BPS: UInt64 = UInt64(25)
BPS_DENOMINATOR: UInt64 = UInt64(10_000)
# MBR = 2500 + 400*(37+81) = 49700
# key: 5-byte prefix "flip:" + 32-byte address = 37 bytes
# value: FlipState = 8+8+32+1+32 = 81 bytes
BOX_MBR: UInt64 = UInt64(49_700)
# ~48h at 2.5s/block: 48 * 3600 / 2.5 = 69120 rounds
REFUND_WINDOW_ROUNDS: UInt64 = UInt64(69_120)
MAINNET_BEACON_APP_ID: UInt64 = UInt64(947_957_720)


class FlipState(arc4.Struct):
    """ARC4 struct stored per active player flip. Total: 81 bytes."""
    vrf_round: arc4.UInt64                                    # 8 bytes
    bet_amount: arc4.UInt64                                   # 8 bytes
    salt_hash: arc4.StaticArray[arc4.Byte, typing.Literal[32]]  # 32 bytes
    claimed: arc4.Bool                                        # 1 byte
    referrer: arc4.Address                                    # 32 bytes


class CoinflipContract(ARC4Contract):
    """VRF-backed coin flip game. Depends on HouseTreasury for payouts."""

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.treasury_app_id = GlobalState(UInt64)
        self.beacon_app_id = GlobalState(UInt64)
        self.leaderboard_app_id = GlobalState(UInt64)
        self.min_bet = GlobalState(UInt64)
        self.max_bet = GlobalState(UInt64)
        self.paused = GlobalState(UInt64)
        self.jackpot_bps = GlobalState(UInt64)
        self.jackpot_balance = GlobalState(UInt64)
        self.jackpot_win_odds = GlobalState(UInt64)
        self.total_bets = GlobalState(UInt64)
        self.total_volume = GlobalState(UInt64)
        # arc4.Address key: 32 bytes on-chain, no ARC-4 length prefix
        self.flips = BoxMap(arc4.Address, FlipState, key_prefix=b"flip:")

    @arc4.abimethod(create="require")
    def create(
        self,
        admin: arc4.Address,
        treasury_app_id: arc4.UInt64,
        beacon_app_id: arc4.UInt64,
        min_bet: arc4.UInt64,
        max_bet: arc4.UInt64,
    ) -> None:
        """Deploy CoinflipContract."""
        self.admin.value = admin.native
        self.treasury_app_id.value = treasury_app_id.native
        self.beacon_app_id.value = beacon_app_id.native
        self.min_bet.value = min_bet.native
        self.max_bet.value = max_bet.native
        self.paused.value = UInt64(0)
        self.jackpot_bps.value = UInt64(0)
        self.jackpot_balance.value = UInt64(0)
        self.jackpot_win_odds.value = UInt64(1000)
        self.total_bets.value = UInt64(0)
        self.total_volume.value = UInt64(0)
        self.leaderboard_app_id.value = UInt64(0)

    @arc4.abimethod
    def flip(
        self,
        pay: gtxn.PaymentTransaction,
        salt_hash: arc4.StaticArray[arc4.Byte, typing.Literal[32]],
        referrer: arc4.Address,
    ) -> arc4.UInt64:
        """
        Commit a coin flip.

        Called as an ABI method with a grouped payment transaction (pay).
        Payment amount must be >= bet + BOX_MBR.

        Money path:
            Player sends (bet + BOX_MBR) to this contract address.
            BOX_MBR covers on-chain box storage cost (returned to contract on delete).
            On win: HouseTreasury.pay_winner() sends (net_payout) to player.
            On win + referrer: referral_amount deducted from net_payout, sent to referrer.

        Args:
            pay:       Grouped payment transaction in the same atomic group.
            salt_hash: 32-byte client-side salt hash for outcome derivation.
            referrer:  Referrer address. Use zero address if none.

        Returns the VRF beacon round committed to.
        """
        assert self.paused.value == UInt64(0), "contract is paused"

        player = arc4.Address(Txn.sender.bytes)
        assert not self.flips.maybe(player)[1], "player already has an active flip"

        # Validate the grouped payment
        assert pay.receiver == Global.current_application_address, "payment must go to contract"
        gross_payment = pay.amount
        assert gross_payment > BOX_MBR, "payment too small to cover MBR"
        bet_amount = gross_payment - BOX_MBR

        assert bet_amount >= self.min_bet.value, "bet below minimum"
        assert bet_amount <= self.max_bet.value, "bet above maximum"

        # Guard: no self-referral. Zero address means no referrer (skip silently in resolve).
        assert referrer.native != Txn.sender, "referrer cannot be player"

        commit_round = Global.round + BEACON_DELAY

        self.flips[player] = FlipState(
            vrf_round=arc4.UInt64(commit_round),
            bet_amount=arc4.UInt64(bet_amount),
            salt_hash=salt_hash.copy(),
            claimed=arc4.Bool(False),
            referrer=referrer.copy(),
        )

        self.total_bets.value = self.total_bets.value + UInt64(1)
        self.total_volume.value = self.total_volume.value + bet_amount

        return arc4.UInt64(commit_round)

    @arc4.abimethod
    def resolve(self, player: arc4.Address) -> arc4.Bool:
        """
        Resolve a committed flip after commit_round + BEACON_SETTLE_BUFFER passes.

        Permissionless. Idempotent: missing box == already resolved (returns False).

        VRF derivation:
            randomness = arc4.abi_call must_get(vrf_round, []) -> byte[]
            beacon_output = randomness.bytes[2:]  # strip 2-byte ARC-4 length prefix
            outcome = sha256(beacon_output || salt_hash)[0] % 2
            0 = loss, 1 = win

        Money path on win:
            gross_payout = bet * 2
            net_payout   = gross_payout * (10000 - HOUSE_EDGE_BPS) // 10000
            referral_amt = bet * REFERRAL_BPS // 10000  (deducted from net_payout)
            net_to_player = net_payout - referral_amt   (if referrer set, else net_payout)

        Returns True if player won, False if lost or already resolved.
        """
        assert self.paused.value == UInt64(0), "contract is paused"

        state, exists = self.flips.maybe(player)
        if not exists:
            return arc4.Bool(False)

        commit_round = state.vrf_round.native
        assert Global.round >= commit_round + BEACON_SETTLE_BUFFER, "VRF beacon not yet settled"

        # Call Applied Blockchain VRF beacon via ABI.
        # must_get panics if the round is not stored -- correct behavior, revert on missing round.
        # beacon returns byte[] (ARC-4 encoded): 2-byte big-endian length prefix + 32 raw bytes.
        # fee=0: pooled from the outer transaction (required; nonzero drains treasury).
        randomness, _beacon_txn = arc4.abi_call[arc4.DynamicBytes](
            "must_get(uint64,byte[])byte[]",
            arc4.UInt64(commit_round),
            arc4.DynamicBytes(Bytes(b"")),
            app_id=algopy.Application(self.beacon_app_id.value),
            fee=UInt64(0),
        )
        # strip the 2-byte ARC-4 length prefix to get the 32 raw VRF bytes
        beacon_output = randomness.bytes[2:]

        # Outcome: sha256(beacon_output || salt_hash)[0] % 2
        # 0 = loss, 1 = win
        combined = beacon_output + state.salt_hash.bytes
        outcome_hash = op.sha256(combined)
        outcome = op.getbyte(outcome_hash, 0) % UInt64(2)

        bet = state.bet_amount.native
        player_won = outcome == UInt64(1)

        if player_won:
            gross_payout = bet * UInt64(2)
            net_payout = gross_payout * (BPS_DENOMINATOR - HOUSE_EDGE_BPS) // BPS_DENOMINATOR

            # Referral: skip if referrer is zero address or was already validated != player
            referrer_addr = state.referrer.native
            zero_addr = Global.zero_address
            referral_paid = UInt64(0)
            if referrer_addr != zero_addr:
                referral_amount = bet * REFERRAL_BPS // BPS_DENOMINATOR
                referral_paid = referral_amount
                itxn.Payment(
                    receiver=referrer_addr,
                    amount=referral_amount,
                    fee=UInt64(0),
                ).submit()

            net_to_player = net_payout - referral_paid

            # Inner call to HouseTreasury.pay_winner() -- fee=0 pools from outer txn
            itxn.ApplicationCall(
                app_id=self.treasury_app_id.value,
                app_args=(
                    arc4.arc4_signature("pay_winner(address,uint64)void"),
                    player,
                    arc4.UInt64(net_to_player),
                ),
                fee=UInt64(0),
            ).submit()

            # TODO(FG-001): leaderboard inner call on win
            # if self.leaderboard_app_id.value > UInt64(0):
            #     itxn.ApplicationCall(
            #         app_id=self.leaderboard_app_id.value,
            #         app_args=(
            #             arc4.arc4_signature("record_result(address,bool,uint64,uint64,bool)void"),
            #             player,
            #             arc4.Bool(True),
            #             arc4.UInt64(bet),
            #             arc4.UInt64(net_to_player),
            #             arc4.Bool(False),  # jackpot_hit
            #         ),
            #         fee=UInt64(0),
            #     ).submit()

            # TODO(FG-002): jackpot check if jackpot_bps > 0 (v1.2)
        else:
            # TODO(FG-001): leaderboard inner call on loss
            # if self.leaderboard_app_id.value > UInt64(0):
            #     itxn.ApplicationCall(
            #         app_id=self.leaderboard_app_id.value,
            #         app_args=(
            #             arc4.arc4_signature("record_result(address,bool,uint64,uint64,bool)void"),
            #             player,
            #             arc4.Bool(False),
            #             arc4.UInt64(bet),
            #             arc4.UInt64(0),
            #             arc4.Bool(False),
            #         ),
            #         fee=UInt64(0),
            #     ).submit()
            pass

        # Delete box LAST -- non-existence is the idempotency guard on retry
        del self.flips[player]

        return arc4.Bool(player_won)

    @arc4.abimethod
    def refund(self) -> None:
        """
        Player-triggered refund. Available after REFUND_WINDOW_ROUNDS (~48h) from commit_round.

        Safety hatch: if keeper is permanently down, player recovers bet + MBR.
        Only callable if resolve() never ran (box still exists, claimed == False).
        """
        player = arc4.Address(Txn.sender.bytes)
        state, exists = self.flips.maybe(player)
        assert exists, "no active flip for this address"
        assert not state.claimed.native, "flip already claimed"

        commit_round = state.vrf_round.native
        elapsed = Global.round - commit_round
        assert elapsed >= REFUND_WINDOW_ROUNDS, "48h refund window has not elapsed"

        bet = state.bet_amount.native

        # Return bet from treasury via pay_winner; fee=0 pools from outer txn
        itxn.ApplicationCall(
            app_id=self.treasury_app_id.value,
            app_args=(
                arc4.arc4_signature("pay_winner(address,uint64)void"),
                player,
                arc4.UInt64(bet),
            ),
            fee=UInt64(0),
        ).submit()

        # Delete box (reclaims MBR to contract), then send MBR back to player
        del self.flips[player]

        itxn.Payment(
            receiver=Txn.sender,
            amount=BOX_MBR,
            fee=UInt64(0),
        ).submit()

    @arc4.abimethod
    def set_paused(self, paused: arc4.Bool) -> None:
        """Pause or unpause. Admin only."""
        self._require_admin()
        self.paused.value = UInt64(1) if paused.native else UInt64(0)

    @arc4.abimethod
    def set_min_bet(self, min_bet: arc4.UInt64) -> None:
        """Update minimum bet. Admin only."""
        self._require_admin()
        assert min_bet.native > UInt64(0), "min_bet must be positive"
        assert min_bet.native <= self.max_bet.value, "min_bet cannot exceed max_bet"
        self.min_bet.value = min_bet.native

    @arc4.abimethod
    def set_max_bet(self, max_bet: arc4.UInt64) -> None:
        """Update maximum bet. Admin only."""
        self._require_admin()
        assert max_bet.native >= self.min_bet.value, "max_bet cannot be less than min_bet"
        self.max_bet.value = max_bet.native

    @arc4.abimethod
    def set_leaderboard_app_id(self, app_id: arc4.UInt64) -> None:
        """Enable/disable leaderboard. Admin only. 0 = disabled."""
        self._require_admin()
        self.leaderboard_app_id.value = app_id.native

    @arc4.abimethod
    def set_beacon_app_id(self, app_id: arc4.UInt64) -> None:
        """Override beacon app ID. Admin only. Use for LocalNet/testnet."""
        self._require_admin()
        self.beacon_app_id.value = app_id.native

    @arc4.abimethod
    def set_jackpot_bps(self, bps: arc4.UInt64, win_odds: arc4.UInt64) -> None:
        """Configure jackpot. Admin only. v1.2+ feature."""
        self._require_admin()
        assert bps.native <= UInt64(500), "jackpot_bps cannot exceed 5%"
        assert win_odds.native > UInt64(0), "win_odds must be positive"
        self.jackpot_bps.value = bps.native
        self.jackpot_win_odds.value = win_odds.native

    @arc4.abimethod(readonly=True)
    def get_flip_state(self, player: arc4.Address) -> FlipState:
        """Return flip state for a player. Raises if no active flip."""
        state, exists = self.flips.maybe(player)
        assert exists, "no active flip for player"
        return state.copy()

    @arc4.abimethod(readonly=True)
    def has_active_flip(self, player: arc4.Address) -> arc4.Bool:
        """Return True if player has an active flip."""
        _, exists = self.flips.maybe(player)
        return arc4.Bool(exists)

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin.value, "sender is not admin"
