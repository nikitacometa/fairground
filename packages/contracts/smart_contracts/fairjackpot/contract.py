"""
FairJackpot -- the Daily Pot. Cross-game daily VRF lottery vault.

Every settled bet on a registered game streams a jackpot cut (1.5% of the stake,
computed by the game) into this contract and accrues lottery tickets for the player:
1 ticket per 1 ALGO cumulative wagered within the epoch, with a minnow floor of
1 ticket for any wallet with at least one settled bet. Once a day (epoch boundary,
20:00 UTC) a permissionless commit/resolve pair draws 1 winner + N runners-up via
the Algorand VRF beacon, weighted by tickets. 10% of the pot (plus integer dust and
any excluded-slot payouts) rolls over to the next pot, so the pot is never zero.

Design doc: docs/design/fairjackpot-v1.md. Key decisions:

Ticket ledger (per epoch) is an append-only list of delta entries with cumulative
sums, stored in fixed-size page boxes. A player's entry is never updated in place
(that would shift every later prefix sum); instead each ticket increase appends a
new (address, cum_after) entry. A player with k entries owns k ticket ranges whose
total measure equals their tickets -- win probability is exact.

Draw verification is hint-based O(1): the resolver (keeper, but anyone can) binary
searches the page boxes off-chain and passes one entry index per winner slot; the
contract recomputes w_i = btoi(sha256(vrf || itob(i))[:8]) % total_tickets and
asserts cum_after[hint-1] <= w_i < cum_after[hint] (lower bound is 0 for hint==0).
A wrong hint reverts. No on-chain iteration, no opcode-budget cliff.

Epochs advance at commit_draw (not resolve): bets settling in the commit->resolve
window accrue into the new epoch, the drawn snapshot stays clean. Payout params are
snapshotted at commit so set_params can never alter a committed draw.

Boxes (raw op.Box, manual keys):
    player accumulator: key = b"t" + itob(epoch) + address (41 B)
                        value = wagered(8) + tickets_issued(8) (16 B)
                        MBR = 2500 + 400*(41+16) = 25,300 microALGO
    ledger page:        key = b"p" + itob(epoch) + itob(page) (17 B)
                        value = 102 entries x (address(32) + cum_after(8)) = 4,080 B
                        MBR = 2500 + 400*(17+4080) = 1,641,300 microALGO

Box MBR is paid from this contract's own operational float (seeded at deploy,
reclaimed by cleanup() of resolved epochs). accrue() must NEVER revert the calling
game's resolve(): on float exhaustion it degrades gracefully (keeps the payment,
skips ticket issuance, emits AccrueSkipped for keeper alerting).

resolve_draw() KEEPER REQUIREMENTS:
    foreign apps: [beacon_app_id]
    boxes: for each hint h: (0, page(h // 102)); plus (0, page((h-1) // 102)) when
    h > 0 (cross-page lower bound). Up to 12 page refs across 6 slots -> compose
    the group as [resolve_draw, noop, noop] to pool box refs (8 per txn).
    fee: ~15,000 microALGO (beacon call + up to 6 payments + OpUp budget calls).
"""

import typing

import algopy
from algopy import (
    ARC4Contract,
    Account,
    Bytes,
    Global,
    GlobalState,
    OpUpFeeSource,
    Txn,
    UInt64,
    arc4,
    ensure_budget,
    gtxn,
    itxn,
    op,
    subroutine,
    urange,
)

TICKET_UNIT: typing.Final = 1_000_000          # 1 ticket per 1 ALGO cumulative wagered
ENTRIES_PER_PAGE: typing.Final = 102
ENTRY_SIZE: typing.Final = 40                  # address(32) + cum_after(8)
PAGE_VALUE_SIZE: typing.Final = 4_080          # 102 * 40
PLAYER_BOX_MBR: typing.Final = 25_300          # 2500 + 400*(41+16)
PAGE_BOX_MBR: typing.Final = 1_641_300         # 2500 + 400*(17+4080)
# The pot must always keep this much spendable headroom AFTER any MBR allocation so
# winner payouts and the beacon call are never blocked by box-MBR exhaustion.
FLOAT_RESERVE: typing.Final = 5_000_000
BPS_DENOMINATOR: typing.Final = 10_000
EPOCH_SECONDS: typing.Final = 86_400
BEACON_DELAY: typing.Final = 8
BEACON_SETTLE_BUFFER: typing.Final = 4
# The beacon retains ~1512 rounds (~70 min). After this window the committed round
# is gone forever (must_get panics) -- allow a permissionless re-commit.
RECOMMIT_AFTER_ROUNDS: typing.Final = 1_000
DEFAULT_WINNER_BPS: typing.Final = 7_000       # 70% of the pot
DEFAULT_RUNNER_BPS: typing.Final = 400         # 4% per runner-up
DEFAULT_RUNNER_COUNT: typing.Final = 5
MAX_RUNNER_COUNT: typing.Final = 5
DEFAULT_BACKSTOP: typing.Final = 25_000_000    # keeper-side top-up threshold, on-chain for transparency


class TicketsIssued(arc4.Struct):
    player: arc4.Address
    epoch: arc4.UInt64
    delta: arc4.UInt64
    total_player_tickets: arc4.UInt64


class AccrueSkipped(arc4.Struct):
    """Ticket issuance skipped (MBR float exhausted). The jackpot cut is still kept."""

    player: arc4.Address
    epoch: arc4.UInt64


class DrawCommitted(arc4.Struct):
    epoch: arc4.UInt64
    commit_round: arc4.UInt64
    pot: arc4.UInt64
    total_tickets: arc4.UInt64


class DrawSkipped(arc4.Struct):
    """Zero-ticket epoch closed without a draw; the pot rolls over untouched."""

    epoch: arc4.UInt64
    pot: arc4.UInt64


class DrawRecommitted(arc4.Struct):
    epoch: arc4.UInt64
    commit_round: arc4.UInt64


class DrawResolved(arc4.Struct):
    """Complete draw record -- the keeper reconstructs the DB row from this event
    alone after a crash, so it must carry everything (winners in slot order, an
    excluded slot keeps its address with payout 0 for transparency)."""

    epoch: arc4.UInt64
    pot: arc4.UInt64
    rollover: arc4.UInt64
    total_tickets: arc4.UInt64
    commit_round: arc4.UInt64
    vrf_output: arc4.StaticArray[arc4.Byte, typing.Literal[32]]
    winners: arc4.DynamicArray[arc4.Address]
    payouts: arc4.DynamicArray[arc4.UInt64]


class FairJackpot(ARC4Contract):
    """Daily Pot vault: ticket ledger + VRF draw + payouts."""

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.beacon_app_id = GlobalState(UInt64)
        self.paused = GlobalState(UInt64)
        # current accruing epoch
        self.epoch_id = GlobalState(UInt64)
        self.epoch_close_ts = GlobalState(UInt64)
        self.epoch_total_tickets = GlobalState(UInt64)
        self.epoch_entry_count = GlobalState(UInt64)
        self.pot_balance = GlobalState(UInt64)
        self.last_rollover = GlobalState(UInt64)
        # pending draw snapshot (zero when idle)
        self.pending_epoch = GlobalState(UInt64)
        self.pending_commit_round = GlobalState(UInt64)
        self.pending_pot = GlobalState(UInt64)
        self.pending_total_tickets = GlobalState(UInt64)
        self.pending_entry_count = GlobalState(UInt64)
        self.pending_winner_bps = GlobalState(UInt64)
        self.pending_runner_bps = GlobalState(UInt64)
        self.pending_runner_count = GlobalState(UInt64)
        # payout params (apply to FUTURE commits only)
        self.winner_bps = GlobalState(UInt64)
        self.runner_bps = GlobalState(UInt64)
        self.runner_count = GlobalState(UInt64)
        self.backstop_microalgo = GlobalState(UInt64)
        # registries: global slots, not boxes -- saves box refs on the per-flip hot path
        self.game_1 = GlobalState(Account)
        self.game_2 = GlobalState(Account)
        self.game_3 = GlobalState(Account)
        self.game_4 = GlobalState(Account)
        self.excluded_1 = GlobalState(Account)
        self.excluded_2 = GlobalState(Account)
        self.excluded_3 = GlobalState(Account)
        self.excluded_4 = GlobalState(Account)
        self.excluded_5 = GlobalState(Account)
        self.excluded_6 = GlobalState(Account)
        self.excluded_7 = GlobalState(Account)
        self.excluded_8 = GlobalState(Account)

    @arc4.abimethod(create="require")
    def create(
        self,
        admin: arc4.Address,
        beacon_app_id: arc4.UInt64,
        first_close_ts: arc4.UInt64,
    ) -> None:
        """Deploy FairJackpot. first_close_ts is the unix timestamp of the first
        draw boundary (production: next 20:00 UTC; test instances may use minutes)."""
        assert first_close_ts.native > Global.latest_timestamp, "first close must be in the future"
        self.admin.value = admin.native
        self.beacon_app_id.value = beacon_app_id.native
        self.paused.value = UInt64(0)
        self.epoch_id.value = UInt64(1)
        self.epoch_close_ts.value = first_close_ts.native
        self.epoch_total_tickets.value = UInt64(0)
        self.epoch_entry_count.value = UInt64(0)
        self.pot_balance.value = UInt64(0)
        self.last_rollover.value = UInt64(0)
        self.pending_epoch.value = UInt64(0)
        self.pending_commit_round.value = UInt64(0)
        self.pending_pot.value = UInt64(0)
        self.pending_total_tickets.value = UInt64(0)
        self.pending_entry_count.value = UInt64(0)
        self.pending_winner_bps.value = UInt64(0)
        self.pending_runner_bps.value = UInt64(0)
        self.pending_runner_count.value = UInt64(0)
        self.winner_bps.value = UInt64(DEFAULT_WINNER_BPS)
        self.runner_bps.value = UInt64(DEFAULT_RUNNER_BPS)
        self.runner_count.value = UInt64(DEFAULT_RUNNER_COUNT)
        self.backstop_microalgo.value = UInt64(DEFAULT_BACKSTOP)
        self.game_1.value = Global.zero_address
        self.game_2.value = Global.zero_address
        self.game_3.value = Global.zero_address
        self.game_4.value = Global.zero_address
        self.excluded_1.value = Global.zero_address
        self.excluded_2.value = Global.zero_address
        self.excluded_3.value = Global.zero_address
        self.excluded_4.value = Global.zero_address
        self.excluded_5.value = Global.zero_address
        self.excluded_6.value = Global.zero_address
        self.excluded_7.value = Global.zero_address
        self.excluded_8.value = Global.zero_address

    # ------------------------------------------------------------------ accrual

    @arc4.abimethod
    def accrue(self, player: arc4.Address, amount: arc4.UInt64, jackpot_cut: arc4.UInt64) -> None:
        """
        Record a settled wager. Called as an INNER app call from a registered game's
        resolve() (Txn.sender == the game's application address), immediately after
        the game's inner payment of jackpot_cut to this contract.

        NO paused check: a paused pot must never revert the calling game's resolve().
        Pause gates draws, not accrual.
        """
        sender = Txn.sender
        assert (
            sender == self.game_1.value
            or sender == self.game_2.value
            or sender == self.game_3.value
            or sender == self.game_4.value
        ), "caller is not a registered game"

        # Credit the pot first -- the cut payment already landed in the same resolve(),
        # and this is the only place the 1.5% stream becomes drawable pot.
        self.pot_balance.value = self.pot_balance.value + jackpot_cut.native

        player_acct = player.native
        if self._is_excluded(player_acct):
            return  # house wallets: payment kept, structurally zero tickets

        epoch = self.epoch_id.value
        player_key = Bytes(b"t") + op.itob(epoch) + player.bytes

        wagered = UInt64(0)
        issued = UInt64(0)
        player_data, player_box_exists = op.Box.get(player_key)
        if player_box_exists:
            wagered = op.btoi(op.extract(player_data, 0, 8))
            issued = op.btoi(op.extract(player_data, 8, 8))
        wagered = wagered + amount.native

        # tickets = max(1, floor(wagered / 1 ALGO)) -- the minnow floor guarantees
        # any wallet with one settled bet holds at least 1 ticket.
        target = wagered // UInt64(TICKET_UNIT)
        if target == UInt64(0):
            target = UInt64(1)

        if target <= issued:
            # no new tickets this settle -- just persist the wagered accumulator
            if player_box_exists:
                op.Box.replace(player_key, UInt64(0), op.itob(wagered))
            return

        delta = target - issued
        entry_idx = self.epoch_entry_count.value
        page_key = (
            Bytes(b"p") + op.itob(epoch) + op.itob(entry_idx // UInt64(ENTRIES_PER_PAGE))
        )
        page_len, page_box_exists = op.Box.length(page_key)

        # MBR guard: never let ticket issuance revert the game's resolve() or eat
        # the payout headroom. Degrade: keep the cut, skip tickets, alert via event.
        required_mbr = UInt64(0)
        if not player_box_exists:
            required_mbr = required_mbr + UInt64(PLAYER_BOX_MBR)
        if not page_box_exists:
            required_mbr = required_mbr + UInt64(PAGE_BOX_MBR)
        app_acct = Global.current_application_address
        spendable = app_acct.balance - app_acct.min_balance
        if spendable < required_mbr + UInt64(FLOAT_RESERVE):
            if player_box_exists:
                op.Box.replace(player_key, UInt64(0), op.itob(wagered))
            arc4.emit(AccrueSkipped(player=player.copy(), epoch=arc4.UInt64(epoch)))
            return

        if not player_box_exists:
            op.Box.create(player_key, UInt64(16))
        op.Box.replace(player_key, UInt64(0), op.itob(wagered) + op.itob(target))

        if not page_box_exists:
            op.Box.create(page_key, UInt64(PAGE_VALUE_SIZE))
        new_cum = self.epoch_total_tickets.value + delta
        entry_offset = (entry_idx % UInt64(ENTRIES_PER_PAGE)) * UInt64(ENTRY_SIZE)
        op.Box.replace(page_key, entry_offset, player.bytes + op.itob(new_cum))

        self.epoch_total_tickets.value = new_cum
        self.epoch_entry_count.value = entry_idx + UInt64(1)
        arc4.emit(
            TicketsIssued(
                player=player.copy(),
                epoch=arc4.UInt64(epoch),
                delta=arc4.UInt64(delta),
                total_player_tickets=arc4.UInt64(target),
            )
        )

    @arc4.abimethod
    def deposit_pot(self, pay: gtxn.PaymentTransaction) -> None:
        """Credit a direct contribution to the drawable pot: backstop top-ups, the
        v1 seed migration, public donations. Anyone can feed the pot."""
        assert pay.receiver == Global.current_application_address, "payment must go to the pot"
        assert pay.amount > UInt64(0), "empty deposit"
        self.pot_balance.value = self.pot_balance.value + pay.amount

    # ------------------------------------------------------------------ draw

    @arc4.abimethod
    def commit_draw(self) -> None:
        """
        Close the current epoch and commit the draw to a future VRF round.
        Permissionless and time-gated; the epoch advances HERE (not at resolve) so
        bets settling during the commit->resolve window accrue into the new epoch.
        """
        assert self.paused.value == UInt64(0), "contract is paused"
        assert self.pending_epoch.value == UInt64(0), "draw already pending"
        now = Global.latest_timestamp
        close = self.epoch_close_ts.value
        assert now >= close, "epoch not closed yet"

        closed_epoch = self.epoch_id.value
        # Skip missed boundaries (keeper downtime > 24h): the next close is always in
        # the future; the missed days' accruals stay in this one pot.
        periods = (now - close) // UInt64(EPOCH_SECONDS) + UInt64(1)
        self.epoch_close_ts.value = close + periods * UInt64(EPOCH_SECONDS)
        self.epoch_id.value = closed_epoch + UInt64(1)

        # snapshot BEFORE zeroing -- the draw must see the closed epoch's ledger
        total = self.epoch_total_tickets.value
        entries = self.epoch_entry_count.value
        self.epoch_total_tickets.value = UInt64(0)
        self.epoch_entry_count.value = UInt64(0)

        if total == UInt64(0):
            # nothing to draw: the pot rolls over untouched, no VRF commit
            arc4.emit(
                DrawSkipped(epoch=arc4.UInt64(closed_epoch), pot=arc4.UInt64(self.pot_balance.value))
            )
            return

        self.pending_epoch.value = closed_epoch
        self.pending_total_tickets.value = total
        self.pending_entry_count.value = entries
        self.pending_pot.value = self.pot_balance.value
        self.pot_balance.value = UInt64(0)
        # payout split is FIXED at commit time -- set_params can never alter a
        # committed draw (provable fairness requirement)
        self.pending_winner_bps.value = self.winner_bps.value
        self.pending_runner_bps.value = self.runner_bps.value
        self.pending_runner_count.value = self.runner_count.value
        commit_round = self._ceil8_commit_round()
        self.pending_commit_round.value = commit_round
        arc4.emit(
            DrawCommitted(
                epoch=arc4.UInt64(closed_epoch),
                commit_round=arc4.UInt64(commit_round),
                pot=arc4.UInt64(self.pending_pot.value),
                total_tickets=arc4.UInt64(total),
            )
        )

    @arc4.abimethod
    def resolve_draw(self, hints: arc4.DynamicArray[arc4.UInt64]) -> None:
        """
        Resolve the pending draw. Permissionless: hints are untrusted entry indexes
        (one per slot) that the contract verifies against the VRF-derived ticket
        numbers; a wrong hint reverts. Winners are paid by inner transactions; the
        remainder (>= 10% by construction, plus dust and excluded slots) rolls over.
        """
        assert self.paused.value == UInt64(0), "contract is paused"
        pending = self.pending_epoch.value
        assert pending != UInt64(0), "no pending draw"
        commit_round = self.pending_commit_round.value
        assert (
            Global.round >= commit_round + UInt64(BEACON_SETTLE_BUFFER)
        ), "VRF round not yet settled"
        slots = UInt64(1) + self.pending_runner_count.value
        assert hints.length == slots, "hints length mismatch"

        # 6 slots x (sha256 + 2 box reads + range checks) + payments + event emit
        # overruns the base 700 budget -- pull extra budget from the group fee pool.
        ensure_budget(UInt64(2_000), OpUpFeeSource.GroupCredit)

        vrf_output = self._read_beacon(commit_round)

        pot = self.pending_pot.value
        total = self.pending_total_tickets.value
        paid = UInt64(0)
        winners = arc4.DynamicArray[arc4.Address]()
        payouts = arc4.DynamicArray[arc4.UInt64]()

        for i in urange(slots):
            if i == UInt64(0):
                slot_payout = pot * self.pending_winner_bps.value // UInt64(BPS_DENOMINATOR)
            else:
                slot_payout = pot * self.pending_runner_bps.value // UInt64(BPS_DENOMINATOR)

            winning_ticket = op.btoi(op.extract(op.sha256(vrf_output + op.itob(i)), 0, 8)) % total
            hint = hints[i].native
            assert hint < self.pending_entry_count.value, "hint out of range"

            upper = self._entry_cum(pending, hint)
            assert winning_ticket < upper, "ticket above hint range"
            if hint > UInt64(0):
                # lower bound lives in the previous entry (possibly the previous page);
                # hint==0 has an implicit lower bound of 0 -- reading entry -1 would
                # underflow UInt64 and panic on a non-existent box.
                lower = self._entry_cum(pending, hint - UInt64(1))
                assert winning_ticket >= lower, "ticket below hint range"

            winner = self._entry_address(pending, hint)
            winners.append(arc4.Address(winner))
            # Exclusion re-check at payout time: a house wallet that accrued before
            # being excluded must still be unable to win -- its slot rolls over.
            if self._is_excluded(winner):
                payouts.append(arc4.UInt64(0))
                continue
            itxn.Payment(receiver=winner, amount=slot_payout, fee=UInt64(0)).submit()
            payouts.append(arc4.UInt64(slot_payout))
            paid = paid + slot_payout

        rollover = pot - paid
        self.pot_balance.value = self.pot_balance.value + rollover
        self.last_rollover.value = rollover

        self.pending_epoch.value = UInt64(0)
        self.pending_commit_round.value = UInt64(0)
        self.pending_pot.value = UInt64(0)
        self.pending_total_tickets.value = UInt64(0)
        self.pending_entry_count.value = UInt64(0)
        self.pending_winner_bps.value = UInt64(0)
        self.pending_runner_bps.value = UInt64(0)
        self.pending_runner_count.value = UInt64(0)

        vrf32 = arc4.StaticArray[arc4.Byte, typing.Literal[32]].from_bytes(vrf_output)
        arc4.emit(
            DrawResolved(
                epoch=arc4.UInt64(pending),
                pot=arc4.UInt64(pot),
                rollover=arc4.UInt64(rollover),
                total_tickets=arc4.UInt64(total),
                commit_round=arc4.UInt64(commit_round),
                vrf_output=vrf32.copy(),
                winners=winners.copy(),
                payouts=payouts.copy(),
            )
        )

    @arc4.abimethod
    def recommit_draw(self) -> None:
        """
        Re-target an expired pending draw to a fresh VRF round. The beacon retains
        ~70 min of outputs; a draw not resolved in that window is otherwise stuck
        forever. Permissionless, but only after the original round is provably
        beyond rescue-by-keeper (RECOMMIT_AFTER_ROUNDS) -- a live draw cannot be
        re-rolled by racing the resolver.
        """
        assert self.pending_epoch.value != UInt64(0), "no pending draw"
        assert (
            Global.round > self.pending_commit_round.value + UInt64(RECOMMIT_AFTER_ROUNDS)
        ), "draw is still resolvable"
        commit_round = self._ceil8_commit_round()
        self.pending_commit_round.value = commit_round
        arc4.emit(
            DrawRecommitted(
                epoch=arc4.UInt64(self.pending_epoch.value),
                commit_round=arc4.UInt64(commit_round),
            )
        )

    @arc4.abimethod
    def cleanup(
        self,
        epoch: arc4.UInt64,
        players: arc4.DynamicArray[arc4.Address],
        pages: arc4.DynamicArray[arc4.UInt64],
    ) -> None:
        """
        Delete ticket boxes of a fully resolved epoch, reclaiming MBR into the
        operational float. Permissionless: only epochs that can never be read by a
        draw again are deletable. Missing boxes are skipped (no revert on races).
        """
        e = epoch.native
        assert e < self.epoch_id.value, "epoch still accruing"
        assert self.pending_epoch.value != e, "epoch draw still pending"
        for i in urange(players.length):
            op.Box.delete(Bytes(b"t") + op.itob(e) + players[i].bytes)
        for j in urange(pages.length):
            op.Box.delete(Bytes(b"p") + op.itob(e) + op.itob(pages[j].native))

    @arc4.abimethod
    def noop(self, i: arc4.UInt64) -> None:
        """Box-reference/budget carrier for group composition. Does nothing."""

    # ------------------------------------------------------------------ admin

    @arc4.abimethod
    def set_params(
        self,
        winner_bps: arc4.UInt64,
        runner_bps: arc4.UInt64,
        runner_count: arc4.UInt64,
        backstop_microalgo: arc4.UInt64,
    ) -> None:
        """Update the payout split for FUTURE commits. Admin only."""
        self._require_admin()
        assert runner_count.native >= UInt64(1), "runner_count must be at least 1"
        assert runner_count.native <= UInt64(MAX_RUNNER_COUNT), "runner_count too large"
        assert winner_bps.native > UInt64(0), "winner_bps must be positive"
        assert (
            winner_bps.native + runner_bps.native * runner_count.native <= UInt64(BPS_DENOMINATOR)
        ), "split exceeds 100%"
        self.winner_bps.value = winner_bps.native
        self.runner_bps.value = runner_bps.native
        self.runner_count.value = runner_count.native
        self.backstop_microalgo.value = backstop_microalgo.native

    @arc4.abimethod
    def set_game(self, slot: arc4.UInt64, game_app_id: arc4.UInt64) -> None:
        """Register/replace an authorized game by app id in slot 1-4 (0 clears).
        Admin only. Stores the game's application ADDRESS (accrue caller check)."""
        self._require_admin()
        game_addr = Global.zero_address
        if game_app_id.native != UInt64(0):
            addr, exists = op.AppParamsGet.app_address(game_app_id.native)
            assert exists, "game app does not exist"
            game_addr = addr
        slot_n = slot.native
        if slot_n == UInt64(1):
            self.game_1.value = game_addr
        elif slot_n == UInt64(2):
            self.game_2.value = game_addr
        elif slot_n == UInt64(3):
            self.game_3.value = game_addr
        elif slot_n == UInt64(4):
            self.game_4.value = game_addr
        else:
            assert False, "invalid game slot"  # noqa: B011

    @arc4.abimethod
    def set_excluded(self, slot: arc4.UInt64, addr: arc4.Address) -> None:
        """Set/clear a ticket-excluded house wallet in slot 1-8. Admin only."""
        self._require_admin()
        slot_n = slot.native
        excluded = addr.native
        if slot_n == UInt64(1):
            self.excluded_1.value = excluded
        elif slot_n == UInt64(2):
            self.excluded_2.value = excluded
        elif slot_n == UInt64(3):
            self.excluded_3.value = excluded
        elif slot_n == UInt64(4):
            self.excluded_4.value = excluded
        elif slot_n == UInt64(5):
            self.excluded_5.value = excluded
        elif slot_n == UInt64(6):
            self.excluded_6.value = excluded
        elif slot_n == UInt64(7):
            self.excluded_7.value = excluded
        elif slot_n == UInt64(8):
            self.excluded_8.value = excluded
        else:
            assert False, "invalid exclusion slot"  # noqa: B011

    @arc4.abimethod
    def set_paused(self, paused: arc4.Bool) -> None:
        """Pause draws (commit/resolve). Does NOT gate accrue() or deposits. Admin only."""
        self._require_admin()
        self.paused.value = UInt64(1) if paused.native else UInt64(0)

    @arc4.abimethod
    def set_admin(self, new_admin: arc4.Address) -> None:
        """Transfer admin rights. Current admin only."""
        self._require_admin()
        self.admin.value = new_admin.native

    @arc4.abimethod
    def set_beacon_app_id(self, app_id: arc4.UInt64) -> None:
        """Override the beacon app id. Admin only AND only while paused with no
        pending draw -- the beacon cannot be swapped under a committed draw."""
        self._require_admin()
        assert self.paused.value == UInt64(1), "must pause before changing beacon"
        assert self.pending_epoch.value == UInt64(0), "draw pending"
        self.beacon_app_id.value = app_id.native

    # ------------------------------------------------------------------ readonly

    @arc4.abimethod(readonly=True)
    def get_player_tickets(self, epoch: arc4.UInt64, player: arc4.Address) -> arc4.UInt64:
        """Tickets issued to a player in an epoch (0 if no settled bets)."""
        data, exists = op.Box.get(Bytes(b"t") + op.itob(epoch.native) + player.bytes)
        if not exists:
            return arc4.UInt64(0)
        return arc4.UInt64(op.btoi(op.extract(data, 8, 8)))

    @arc4.abimethod(readonly=True)
    def get_pot(self) -> arc4.UInt64:
        return arc4.UInt64(self.pot_balance.value)

    # ------------------------------------------------------------------ internals

    @subroutine
    def _read_beacon(self, commit_round: UInt64) -> Bytes:
        """Read the 32-byte VRF output for a settled round. Isolated as a seam so
        offline tests can patch it; must_get panics if the round is not stored."""
        randomness, _txn = arc4.abi_call[arc4.DynamicBytes](
            "must_get(uint64,byte[])byte[]",
            arc4.UInt64(commit_round),
            arc4.DynamicBytes(Bytes(b"")),
            app_id=algopy.Application(self.beacon_app_id.value),
            fee=UInt64(0),
        )
        return randomness.bytes[2:]  # strip the 2-byte ARC-4 length prefix

    @subroutine
    def _ceil8_commit_round(self) -> UInt64:
        """Next beacon-aligned round at least BEACON_DELAY ahead (the beacon only
        stores outputs for rounds that are multiples of 8)."""
        return ((Global.round + UInt64(BEACON_DELAY) + UInt64(7)) // UInt64(8)) * UInt64(8)

    @subroutine
    def _entry_cum(self, epoch: UInt64, entry_idx: UInt64) -> UInt64:
        page_key = Bytes(b"p") + op.itob(epoch) + op.itob(entry_idx // UInt64(ENTRIES_PER_PAGE))
        offset = (entry_idx % UInt64(ENTRIES_PER_PAGE)) * UInt64(ENTRY_SIZE)
        return op.btoi(op.Box.extract(page_key, offset + UInt64(32), UInt64(8)))

    @subroutine
    def _entry_address(self, epoch: UInt64, entry_idx: UInt64) -> Account:
        page_key = Bytes(b"p") + op.itob(epoch) + op.itob(entry_idx // UInt64(ENTRIES_PER_PAGE))
        offset = (entry_idx % UInt64(ENTRIES_PER_PAGE)) * UInt64(ENTRY_SIZE)
        return Account.from_bytes(op.Box.extract(page_key, offset, UInt64(32)))

    @subroutine
    def _is_excluded(self, acct: Account) -> bool:
        return (
            acct == self.excluded_1.value
            or acct == self.excluded_2.value
            or acct == self.excluded_3.value
            or acct == self.excluded_4.value
            or acct == self.excluded_5.value
            or acct == self.excluded_6.value
            or acct == self.excluded_7.value
            or acct == self.excluded_8.value
        )

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin.value, "sender is not admin"
