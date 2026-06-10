"""
CoinflipContract -- CometaFlip v2. VRF-backed 50/50 coin flip + Daily Pot stream.

Capital model (see house_treasury/contract.py): the player's stake escrows in THIS
contract during the pending window. On resolve() the stake is split: referral cut to
the referrer, jackpot cut to the FairJackpot pot (with an inner accrue() call that
issues lottery tickets), the remainder swept into HouseTreasury, and on a win
HouseTreasury.pay_winner() pays the player. The box-MBR deposit is returned to the
player on resolve(). refund() pays bet + MBR back from THIS contract's own balance
and never touches the treasury or the pot, so the 48h backdoor works even when the
treasury is paused.

v2 changes (docs/design/fairjackpot-v1.md):
    - house_edge_bps / referral_bps / jackpot_bps are CREATE ARGS stored in global
      state and read by resolve() -- the split is verifiable on-chain via a plain
      algod global-state read (spec hard requirement), and the founder picks the
      final edge at deploy time without a recompile.
    - resolve() streams jackpot_bps of the stake to the FairJackpot app and calls
      accrue(player, bet, cut) so ticket accrual is atomic with settlement.
    - set_admin() (audit H-6) and a ~6h timelock on beacon changes (oracle
      substitution is a total-drain vector; a timelock makes it observable).

Flow:
    1. flip(pay, salt_hash, referrer): group [payment(bet + BOX_MBR) -> contract, app call].
       Commits to VRF beacon round = ceil8(current_round + BEACON_DELAY).
    2. resolve(player): permissionless, after commit_round + BEACON_SETTLE_BUFFER (4).
       outcome = sha256(beacon_output || salt_hash)[0] % 2  (1 = win, 0 = loss).
       Pays referral, streams the jackpot cut + accrue(), sweeps the remainder to the
       treasury, on a win calls treasury.pay_winner(player, bet*2*(10000-edge)/10000),
       then returns BOX_MBR and deletes the box.
    3. refund(): after REFUND_WINDOW_ROUNDS (~48h), the player reclaims bet + MBR.

VRF beacon (Applied Blockchain): app id supplied at deploy (mainnet 1615566206).
    ABI: must_get(uint64,byte[])byte[] -- panics if the round is not stored (correct).
    Stores ~189 outputs x 8 = ~1512 rounds (~70 min). Keeper SLA: resolve within ~60 min.

Box storage:
    BoxMap key_prefix=b"flip:" + arc4.Address(32) -> on-chain key = 5 + 32 = 37 bytes
    value FlipState = vrf_round(8) + bet_amount(8) + salt_hash(32) + referrer(32) = 80 bytes
    MBR = 2500 + 400*(37 + 80) = 49,300 microALGO  (include in the flip() payment)

resolve() KEEPER REQUIREMENTS (otherwise the inner calls fail with an invalid reference):
    foreign apps: [treasury_app_id, beacon_app_id, jackpot_app_id]
    boxes:        [(0, b"flip:" + player_address),
                   (treasury_app_id, b"game:" + this_app_address),
                   (jackpot_app_id, b"t" + itob(pot_epoch) + player_address),
                   (jackpot_app_id, b"p" + itob(pot_epoch) + itob(current_page)),
                   (jackpot_app_id, b"p" + itob(pot_epoch) + itob(current_page + 1))]
    pot_epoch / current_page come from FairJackpot global state (epoch_id,
    epoch_entry_count // 102) -- fetch once per keeper batch; wrong epoch or page is
    an `invalid box reference`. extraFee: 10,000 microALGO (up to 8 inner txns).
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
MAX_HOUSE_EDGE_BPS: typing.Final = 1_000    # 10% sanity ceiling on the create arg
BPS_DENOMINATOR: typing.Final = 10_000
BOX_MBR: typing.Final = 49_300              # 2500 + 400*(37 + 80)
# ~48h at 2.8s/block: 48 * 3600 / 2.8 ~= 61,714 rounds
REFUND_WINDOW_ROUNDS: typing.Final = 61_714
# ~6h: beacon swap is an oracle-substitution drain vector; the timelock makes a
# malicious change observable long before it can take effect.
BEACON_TIMELOCK_ROUNDS: typing.Final = 7_714


class FlipState(arc4.Struct):
    """ARC-4 struct stored per active player flip. Total: 80 bytes."""

    vrf_round: arc4.UInt64                                       # 8 bytes
    bet_amount: arc4.UInt64                                      # 8 bytes
    salt_hash: arc4.StaticArray[arc4.Byte, typing.Literal[32]]   # 32 bytes
    referrer: arc4.Address                                       # 32 bytes


class CoinflipContract(ARC4Contract):
    """VRF-backed coin flip. Depends on HouseTreasury for payouts and streams the
    Daily Pot cut to FairJackpot."""

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.treasury_app_id = GlobalState(UInt64)
        self.beacon_app_id = GlobalState(UInt64)
        self.min_bet = GlobalState(UInt64)
        self.max_bet = GlobalState(UInt64)
        self.paused = GlobalState(UInt64)
        self.total_bets = GlobalState(UInt64)
        self.total_volume = GlobalState(UInt64)
        # economics -- create args, immutable per app version, readable via algod
        self.house_edge_bps = GlobalState(UInt64)
        self.referral_bps = GlobalState(UInt64)
        self.jackpot_bps = GlobalState(UInt64)
        self.jackpot_app_id = GlobalState(UInt64)
        self.jackpot_app_addr = GlobalState(Account)
        # beacon-change timelock
        self.pending_beacon_app_id = GlobalState(UInt64)
        self.pending_beacon_round = GlobalState(UInt64)
        self.flips = BoxMap(arc4.Address, FlipState, key_prefix=b"flip:")

    @arc4.abimethod(create="require")
    def create(
        self,
        admin: arc4.Address,
        treasury_app_id: arc4.UInt64,
        beacon_app_id: arc4.UInt64,
        min_bet: arc4.UInt64,
        max_bet: arc4.UInt64,
        house_edge_bps: arc4.UInt64,
        referral_bps: arc4.UInt64,
        jackpot_app_id: arc4.UInt64,
        jackpot_bps: arc4.UInt64,
    ) -> None:
        """Deploy CoinflipContract. treasury_app_id and the economics are immutable
        after creation. jackpot_app_id may be 0 (no pot stream -- test deployments)."""
        assert min_bet.native > UInt64(0), "min_bet must be positive"
        assert max_bet.native >= min_bet.native, "max_bet cannot be less than min_bet"
        assert house_edge_bps.native > UInt64(0), "house_edge_bps must be positive"
        assert house_edge_bps.native <= UInt64(MAX_HOUSE_EDGE_BPS), "house_edge_bps exceeds 10%"
        # referral + jackpot are paid per stake; the edge is collected on average --
        # this keeps the expected house net non-negative.
        assert (
            referral_bps.native + jackpot_bps.native <= house_edge_bps.native
        ), "referral + jackpot cannot exceed the house edge"
        self.admin.value = admin.native
        self.treasury_app_id.value = treasury_app_id.native
        self.beacon_app_id.value = beacon_app_id.native
        self.min_bet.value = min_bet.native
        self.max_bet.value = max_bet.native
        self.paused.value = UInt64(0)
        self.total_bets.value = UInt64(0)
        self.total_volume.value = UInt64(0)
        self.house_edge_bps.value = house_edge_bps.native
        self.referral_bps.value = referral_bps.native
        self.jackpot_bps.value = jackpot_bps.native
        self.jackpot_app_id.value = jackpot_app_id.native
        if jackpot_app_id.native != UInt64(0):
            jackpot_addr, exists = op.AppParamsGet.app_address(jackpot_app_id.native)
            assert exists, "jackpot app does not exist"
            self.jackpot_app_addr.value = jackpot_addr
        else:
            self.jackpot_app_addr.value = Global.zero_address
        self.pending_beacon_app_id.value = UInt64(0)
        self.pending_beacon_round.value = UInt64(0)

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
        already resolved -> reverts). See module docstring for the box/app
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

        beacon_output = self._read_beacon(commit_round)
        outcome = op.getbyte(op.sha256(beacon_output + state.salt_hash.bytes), 0) % UInt64(2)
        player_won = outcome == UInt64(1)

        bet = state.bet_amount.native
        treasury = algopy.Application(self.treasury_app_id.value)

        # Referral (referral_bps of the stake) comes out of the house rake, not the
        # player's winnings.
        referrer_addr = state.referrer.native
        referral_amount = UInt64(0)
        if referrer_addr != Global.zero_address:
            referral_amount = bet * self.referral_bps.value // UInt64(BPS_DENOMINATOR)
            itxn.Payment(receiver=referrer_addr, amount=referral_amount, fee=UInt64(0)).submit()

        # Daily Pot stream: jackpot_bps of the stake to the FairJackpot vault plus an
        # accrue() call that issues lottery tickets -- atomic with this settlement.
        jackpot_cut = UInt64(0)
        if self.jackpot_app_id.value != UInt64(0):
            jackpot_cut = bet * self.jackpot_bps.value // UInt64(BPS_DENOMINATOR)
            if jackpot_cut > UInt64(0):
                itxn.Payment(
                    receiver=self.jackpot_app_addr.value, amount=jackpot_cut, fee=UInt64(0)
                ).submit()
            self._accrue_to_jackpot(player, bet, jackpot_cut)

        # Sweep the remaining stake into the treasury bankroll BEFORE the payout so
        # the solvency check sees the larger balance.
        itxn.Payment(
            receiver=treasury.address, amount=bet - referral_amount - jackpot_cut, fee=UInt64(0)
        ).submit()

        if player_won:
            gross = bet * UInt64(2)
            net_payout = gross * (
                UInt64(BPS_DENOMINATOR) - self.house_edge_bps.value
            ) // UInt64(BPS_DENOMINATOR)
            self._pay_winner(player, net_payout)

        # Delete the box (idempotency guard) -- this also unlocks the MBR so it can
        # be returned to the player in the same atomic transaction.
        del self.flips[player]
        itxn.Payment(receiver=player.native, amount=UInt64(BOX_MBR), fee=UInt64(0)).submit()

        return arc4.Bool(player_won)

    @arc4.abimethod
    def refund(self) -> None:
        """
        Player-triggered refund after REFUND_WINDOW_ROUNDS (~48h) from commit.
        Pays bet + MBR back directly from this contract -- no treasury or pot
        dependency, so it works even if the treasury is emergency-paused. Keeper
        failure can never lock player funds. Refunded bets accrue no tickets.
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
    def set_admin(self, new_admin: arc4.Address) -> None:
        """Transfer admin rights. Current admin only. (Audit H-6.)"""
        self._require_admin()
        self.admin.value = new_admin.native

    @arc4.abimethod
    def request_beacon_change(self, app_id: arc4.UInt64) -> None:
        """Start the ~6h timelock for a beacon swap. Admin only. The beacon decides
        every outcome -- an instant swap would let a compromised admin substitute a
        controlled oracle and drain the treasury through scripted wins."""
        self._require_admin()
        self.pending_beacon_app_id.value = app_id.native
        self.pending_beacon_round.value = Global.round

    @arc4.abimethod
    def apply_beacon_change(self) -> None:
        """Apply a requested beacon swap after the timelock. Admin only."""
        self._require_admin()
        assert self.pending_beacon_round.value > UInt64(0), "no beacon change requested"
        assert (
            Global.round >= self.pending_beacon_round.value + UInt64(BEACON_TIMELOCK_ROUNDS)
        ), "beacon timelock has not elapsed"
        self.beacon_app_id.value = self.pending_beacon_app_id.value
        self.pending_beacon_app_id.value = UInt64(0)
        self.pending_beacon_round.value = UInt64(0)

    @arc4.abimethod(readonly=True)
    def get_flip_state(self, player: arc4.Address) -> FlipState:
        """Return the flip state for a player. Raises if no active flip."""
        assert player in self.flips, "no active flip for player"
        return self.flips[player].copy()

    @arc4.abimethod(readonly=True)
    def has_active_flip(self, player: arc4.Address) -> arc4.Bool:
        return arc4.Bool(player in self.flips)

    @subroutine
    def _read_beacon(self, commit_round: UInt64) -> Bytes:
        """Read the 32-byte VRF output. Isolated as a seam so offline tests can
        patch it. Return is ARC-4 byte[]: 2-byte length prefix + 32 raw VRF bytes.
        must_get panics if the round is not stored (correct -- revert)."""
        randomness, _beacon_txn = arc4.abi_call[arc4.DynamicBytes](
            "must_get(uint64,byte[])byte[]",
            arc4.UInt64(commit_round),
            arc4.DynamicBytes(Bytes(b"")),
            app_id=algopy.Application(self.beacon_app_id.value),
            fee=UInt64(0),
        )
        return randomness.bytes[2:]

    @subroutine
    def _pay_winner(self, player: arc4.Address, net_payout: UInt64) -> None:
        """Pay the winner from the treasury bankroll. Isolated as a seam for
        offline tests (abi_call cannot be emulated against a stub app)."""
        arc4.abi_call(
            "pay_winner(address,uint64)void",
            player,
            arc4.UInt64(net_payout),
            app_id=algopy.Application(self.treasury_app_id.value),
            fee=UInt64(0),
        )

    @subroutine
    def _accrue_to_jackpot(self, player: arc4.Address, bet: UInt64, jackpot_cut: UInt64) -> None:
        """Issue Daily Pot tickets for this settled stake. Isolated as a seam for
        offline tests."""
        arc4.abi_call(
            "accrue(address,uint64,uint64)void",
            player,
            arc4.UInt64(bet),
            arc4.UInt64(jackpot_cut),
            app_id=algopy.Application(self.jackpot_app_id.value),
            fee=UInt64(0),
        )

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin.value, "sender is not admin"
