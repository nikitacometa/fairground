"""
CoinflipContract -- CometaFlip v1. VRF-backed 50/50 coin flip.

Capital model (see house_treasury/contract.py): the player's stake escrows in THIS
contract during the pending window. On resolve() the stake is swept into
HouseTreasury (minus any referral) and, on a win, HouseTreasury.pay_winner() pays
the player. The box-MBR deposit is returned to the player on resolve(). refund()
pays bet + MBR back from THIS contract's own balance and never touches the treasury,
so the 48h backdoor works even when the treasury is paused.

Flow:
    1. flip(pay, salt_hash, referrer): group [payment(bet + BOX_MBR) -> contract, app call].
       Commits to VRF beacon round = current_round + BEACON_DELAY (8).
    2. resolve(player): permissionless, after commit_round + BEACON_SETTLE_BUFFER (4).
       outcome = sha256(beacon_output || salt_hash)[0] % 2  (1 = win, 0 = loss).
       Sweeps (bet - referral) to treasury, pays referral, on a win calls
       treasury.pay_winner(player, bet*2*98%), then returns BOX_MBR and deletes the box.
    3. refund(): after REFUND_WINDOW_ROUNDS (~48h), the player reclaims bet + MBR directly.

VRF beacon (Applied Blockchain): app id supplied at deploy (mainnet 947957720).
    ABI: must_get(uint64,byte[])byte[] -- panics if the round is not stored (correct).
    Stores ~189 outputs x 8 = ~1512 rounds (~70 min). Keeper SLA: resolve within ~60 min.

Box storage:
    BoxMap key_prefix=b"flip:" + arc4.Address(32) -> on-chain key = 5 + 32 = 37 bytes
    value FlipState = vrf_round(8) + bet_amount(8) + salt_hash(32) + referrer(32) = 80 bytes
    MBR = 2500 + 400*(37 + 80) = 49,300 microALGO  (include in the flip() payment)

resolve() KEEPER REQUIREMENTS (otherwise the inner calls fail with an invalid reference):
    foreign apps: [treasury_app_id, beacon_app_id]
    boxes:        [(0, b"flip:" + player_address),
                   (treasury_app_id, b"game:" + this_app_address)]
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

BEACON_DELAY: typing.Final = 8
# The beacon writes a proof up to 3 rounds after its ceil-8 target round, so the
# settle buffer must cover that worst case (+1 for confirmation). 2 was too low.
BEACON_SETTLE_BUFFER: typing.Final = 4
HOUSE_EDGE_BPS: typing.Final = 200          # 2%
REFERRAL_BPS: typing.Final = 50             # 0.5% of the stake to the referrer (from house rake)
BPS_DENOMINATOR: typing.Final = 10_000
BOX_MBR: typing.Final = 49_300              # 2500 + 400*(37 + 80)
# ~48h at 2.8s/block: 48 * 3600 / 2.8 ~= 61,714 rounds
REFUND_WINDOW_ROUNDS: typing.Final = 61_714


class FlipState(arc4.Struct):
    """ARC-4 struct stored per active player flip. Total: 80 bytes."""

    vrf_round: arc4.UInt64                                       # 8 bytes
    bet_amount: arc4.UInt64                                      # 8 bytes
    salt_hash: arc4.StaticArray[arc4.Byte, typing.Literal[32]]   # 32 bytes
    referrer: arc4.Address                                       # 32 bytes


class CoinflipContract(ARC4Contract):
    """VRF-backed coin flip. Depends on HouseTreasury for payouts."""

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.treasury_app_id = GlobalState(UInt64)
        self.beacon_app_id = GlobalState(UInt64)
        self.min_bet = GlobalState(UInt64)
        self.max_bet = GlobalState(UInt64)
        self.paused = GlobalState(UInt64)
        self.total_bets = GlobalState(UInt64)
        self.total_volume = GlobalState(UInt64)
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
        """Deploy CoinflipContract. treasury_app_id is immutable after creation."""
        assert min_bet.native > UInt64(0), "min_bet must be positive"
        assert max_bet.native >= min_bet.native, "max_bet cannot be less than min_bet"
        self.admin.value = admin.native
        self.treasury_app_id.value = treasury_app_id.native
        self.beacon_app_id.value = beacon_app_id.native
        self.min_bet.value = min_bet.native
        self.max_bet.value = max_bet.native
        self.paused.value = UInt64(0)
        self.total_bets.value = UInt64(0)
        self.total_volume.value = UInt64(0)

    @arc4.abimethod
    def flip(
        self,
        pay: gtxn.PaymentTransaction,
        salt_hash: arc4.StaticArray[arc4.Byte, typing.Literal[32]],
        referrer: arc4.Address,
    ) -> arc4.UInt64:
        """
        Commit a coin flip. The grouped payment must equal bet + BOX_MBR and be
        sent by the player to this contract. Returns the committed VRF round.
        """
        assert self.paused.value == UInt64(0), "contract is paused"

        player = arc4.Address(Txn.sender.bytes)
        assert player not in self.flips, "player already has an active flip"

        assert pay.sender == Txn.sender, "payment must be from the player"
        assert pay.receiver == Global.current_application_address, "payment must go to contract"
        assert pay.amount > UInt64(BOX_MBR), "payment too small to cover box MBR"
        bet = pay.amount - UInt64(BOX_MBR)
        assert bet >= self.min_bet.value, "bet below minimum"
        assert bet <= self.max_bet.value, "bet above maximum"
        assert referrer.native != Txn.sender, "referrer cannot be the player"

        # The randomness beacon only emits VRF outputs for rounds that are multiples of
        # 8 (its "ceil-8 target round" -- must_get panics on any other round). Round the
        # commit target UP to the next multiple of 8 so a value exists when resolve()
        # reads it. This is at least BEACON_DELAY rounds ahead (8) and at most 15.
        commit_round = ((Global.round + UInt64(BEACON_DELAY) + UInt64(7)) // UInt64(8)) * UInt64(8)
        self.flips[player] = FlipState(
            vrf_round=arc4.UInt64(commit_round),
            bet_amount=arc4.UInt64(bet),
            salt_hash=salt_hash.copy(),
            referrer=referrer.copy(),
        )
        self.total_bets.value = self.total_bets.value + UInt64(1)
        self.total_volume.value = self.total_volume.value + bet
        return arc4.UInt64(commit_round)

    @arc4.abimethod
    def resolve(self, player: arc4.Address) -> arc4.Bool:
        """
        Resolve a committed flip. Permissionless; idempotent (a missing box means
        already resolved -> returns False). See module docstring for the box/app
        references the resolve transaction must declare.
        """
        assert self.paused.value == UInt64(0), "contract is paused"

        # Struct-valued BoxMap: use `in` + indexed .copy() (maybe() cannot be bound/unpacked).
        # Assert (not a silent False) so a DUPLICATE resolve REVERTS instead of being
        # mistaken for a real loss by the keeper. A False return now means only a loss;
        # an already-resolved box reverts and the keeper leaves the bet outcome untouched.
        assert player in self.flips, "no active flip to resolve"
        state = self.flips[player].copy()

        commit_round = state.vrf_round.native
        assert Global.round >= commit_round + UInt64(BEACON_SETTLE_BUFFER), "VRF round not yet settled"

        # Read the VRF beacon. must_get panics if the round is not stored (correct -- revert).
        # Return is ARC-4 byte[]: 2-byte big-endian length prefix + 32 raw VRF bytes.
        # fee=0: pooled from the outer transaction.
        randomness, _beacon_txn = arc4.abi_call[arc4.DynamicBytes](
            "must_get(uint64,byte[])byte[]",
            arc4.UInt64(commit_round),
            arc4.DynamicBytes(Bytes(b"")),
            app_id=algopy.Application(self.beacon_app_id.value),
            fee=UInt64(0),
        )
        beacon_output = randomness.bytes[2:]  # strip the 2-byte ARC-4 length prefix
        outcome = op.getbyte(op.sha256(beacon_output + state.salt_hash.bytes), 0) % UInt64(2)
        player_won = outcome == UInt64(1)

        bet = state.bet_amount.native
        treasury = algopy.Application(self.treasury_app_id.value)

        # Referral (0.5% of the stake) comes out of the house rake, not the player's winnings.
        referrer_addr = state.referrer.native
        referral_amount = UInt64(0)
        if referrer_addr != Global.zero_address:
            referral_amount = bet * UInt64(REFERRAL_BPS) // UInt64(BPS_DENOMINATOR)
            itxn.Payment(receiver=referrer_addr, amount=referral_amount, fee=UInt64(0)).submit()

        # Sweep the remaining stake into the treasury bankroll BEFORE the payout so
        # the solvency check sees the larger balance.
        itxn.Payment(
            receiver=treasury.address, amount=bet - referral_amount, fee=UInt64(0)
        ).submit()

        if player_won:
            gross = bet * UInt64(2)
            net_payout = gross * (UInt64(BPS_DENOMINATOR) - UInt64(HOUSE_EDGE_BPS)) // UInt64(
                BPS_DENOMINATOR
            )
            arc4.abi_call(
                "pay_winner(address,uint64)void",
                player,
                arc4.UInt64(net_payout),
                app_id=treasury,
                fee=UInt64(0),
            )

        # Delete the box (idempotency guard) -- this also unlocks the MBR so it can
        # be returned to the player in the same atomic transaction.
        del self.flips[player]
        itxn.Payment(receiver=player.native, amount=UInt64(BOX_MBR), fee=UInt64(0)).submit()

        return arc4.Bool(player_won)

    @arc4.abimethod
    def refund(self) -> None:
        """
        Player-triggered refund after REFUND_WINDOW_ROUNDS (~48h) from commit.
        Pays bet + MBR back directly from this contract -- no treasury dependency,
        so it works even if the treasury is emergency-paused. Keeper failure can
        never lock player funds.
        """
        player = arc4.Address(Txn.sender.bytes)
        assert player in self.flips, "no active flip for this address"
        state = self.flips[player].copy()

        elapsed = Global.round - state.vrf_round.native
        assert elapsed >= UInt64(REFUND_WINDOW_ROUNDS), "48h refund window has not elapsed"

        bet = state.bet_amount.native
        del self.flips[player]
        itxn.Payment(receiver=Txn.sender, amount=bet + UInt64(BOX_MBR), fee=UInt64(0)).submit()

    @arc4.abimethod
    def set_paused(self, paused: arc4.Bool) -> None:
        """Pause or unpause. Admin only."""
        self._require_admin()
        self.paused.value = UInt64(1) if paused.native else UInt64(0)

    @arc4.abimethod
    def set_min_bet(self, min_bet: arc4.UInt64) -> None:
        """Update the minimum bet. Admin only."""
        self._require_admin()
        assert min_bet.native > UInt64(0), "min_bet must be positive"
        assert min_bet.native <= self.max_bet.value, "min_bet cannot exceed max_bet"
        self.min_bet.value = min_bet.native

    @arc4.abimethod
    def set_max_bet(self, max_bet: arc4.UInt64) -> None:
        """Update the maximum bet. Admin only."""
        self._require_admin()
        assert max_bet.native >= self.min_bet.value, "max_bet cannot be less than min_bet"
        self.max_bet.value = max_bet.native

    @arc4.abimethod
    def set_beacon_app_id(self, app_id: arc4.UInt64) -> None:
        """Override the beacon app ID. Admin only. Use for LocalNet/testnet."""
        self._require_admin()
        self.beacon_app_id.value = app_id.native

    @arc4.abimethod(readonly=True)
    def get_flip_state(self, player: arc4.Address) -> FlipState:
        """Return the flip state for a player. Raises if no active flip."""
        assert player in self.flips, "no active flip for player"
        return self.flips[player].copy()

    @arc4.abimethod(readonly=True)
    def has_active_flip(self, player: arc4.Address) -> arc4.Bool:
        return arc4.Bool(player in self.flips)

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin.value, "sender is not admin"
