"""
Deploy orchestration for the Fairground smart contracts.

Deploy order (enforced by the dependency graph):
    1. HouseTreasury        — the shared bankroll; no external deps.
    2. FairJackpot          — the Daily Pot vault; needs only the beacon id.
    3. CoinflipContract     — depends on HouseTreasury + FairJackpot + the VRF beacon.
    4. LeaderboardContract  — standalone stub; deployed but NOT wired into Coinflip.

After deploying CoinflipContract it is registered in HouseTreasury (register_game,
grouped MBR payment of GAME_BOX_MBR) and in FairJackpot (set_game slot 1).

Run:
    algokit project deploy            # uses .algokit.toml + this file
    python -m smart_contracts.deploy_config   # or directly

Environment:
    DEPLOYER_MNEMONIC          — deployer/admin wallet (auto-funded from the LocalNet dispenser)
    ALGORAND_NETWORK           — localnet | testnet | mainnet (default: localnet)
    ALGOD_SERVER / ALGOD_PORT / ALGOD_TOKEN  — read by AlgorandClient.from_environment()
    MIN_BET_MICROALGO          — default 500000 (0.5 ALGO)
    MAX_BET_MICROALGO          — default 500000 (0.5 ALGO)
    HOUSE_EDGE_BPS             — default 500 (5%, pays 1.90x). Founder decides 500 vs 450 HERE.
    REFERRAL_BPS               — default 100 (1% of stake to the referrer)
    JACKPOT_BPS                — default 150 (1.5% of stake streams to the Daily Pot)
    JACKPOT_FIRST_CLOSE_TS     — unix ts of the first draw boundary (default: next 20:00 UTC)
    SEED_TREASURY_MICROALGO    — optional initial bankroll deposit (default 0 = skip)
    SEED_JACKPOT_FLOAT_MICROALGO — pot operational float for box MBR (default 50 ALGO)
    SEED_JACKPOT_POT_MICROALGO — optional initial pot deposit via deposit_pot (default 0)
                                 (mainnet release: coinflip_v1.total_volume * 100 // 10_000)

NOTE: end-to-end deploy is exercised against AlgoKit LocalNet (Docker compose >= 2.5.0).
The VRF beacon does not exist on LocalNet, so beacon_app_id is 0 there; set a mock via
the beacon-change path before exercising resolve() / resolve_draw() on LocalNet.
"""

import logging
import os
import time

import algokit_utils
from algokit_utils import AlgoAmount, AlgorandClient, PaymentParams

from smart_contracts.coinflip.coinflip_client import (
    CoinflipContractFactory,
    CreateArgs as CoinflipCreateArgs,
)
from smart_contracts.fairjackpot.fairjackpot_client import (
    CreateArgs as FairJackpotCreateArgs,
    DepositPotArgs,
    FairJackpotFactory,
    SetGameArgs,
)
from smart_contracts.house_treasury.house_treasury_client import (
    CreateArgs as HouseTreasuryCreateArgs,
    DepositArgs,
    HouseTreasuryFactory,
    RegisterGameArgs,
    SetMaxPayoutBpsArgs,
)
from smart_contracts.leaderboard.leaderboard_client import (
    CreateArgs as LeaderboardCreateArgs,
    LeaderboardContractFactory,
)

logger = logging.getLogger(__name__)

# Mirror packages/sdk/src/vrf/beacon.ts.
# 1615566206 is the live mainnet randomness beacon (947957720 is a dead 2022 deployment).
MAINNET_BEACON_APP_ID = 1_615_566_206
TESTNET_BEACON_APP_ID = 110_096_026  # UNVERIFIED -- confirm before testnet use

# 2500 + 400*(37+8); charged when registering a game in the treasury.
GAME_BOX_MBR = 20_500
# Base balance to cover each app account's min-balance (global state + base) at creation.
APP_BASE_FUNDING = 300_000
DRAW_HOUR_UTC = 20


def _beacon_app_id(network: str) -> int:
    """Resolve the VRF beacon app ID for the target network (0 on LocalNet)."""
    if network == "mainnet":
        return MAINNET_BEACON_APP_ID
    if network == "testnet":
        return TESTNET_BEACON_APP_ID
    return 0


def _next_draw_close_ts() -> int:
    """Unix timestamp of the next 20:00 UTC boundary."""
    now = int(time.time())
    midnight = now - (now % 86_400)
    close = midnight + DRAW_HOUR_UTC * 3_600
    return close if close > now else close + 86_400


def _fund_app(algorand: AlgorandClient, sender: str, app_address: str, micro_algo: int) -> None:
    """Top up an app account so it can cover its min balance (boxes, global state)."""
    algorand.send.payment(
        PaymentParams(
            sender=sender,
            receiver=app_address,
            amount=AlgoAmount(micro_algo=micro_algo),
        )
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    algorand = AlgorandClient.from_environment()
    # Wide validity window: public AlgoNode endpoints are load-balanced and can lag a
    # few rounds between fetching suggested params and simulate/send, which kills txns
    # with the short default window ("txn dead: round X outside of ...").
    algorand.set_default_validity_window(1000)
    deployer = algorand.account.from_environment("DEPLOYER")
    network = os.getenv("ALGORAND_NETWORK", "localnet")
    beacon_app_id = _beacon_app_id(network)
    min_bet = int(os.getenv("MIN_BET_MICROALGO", "500000"))
    max_bet = int(os.getenv("MAX_BET_MICROALGO", "500000"))
    house_edge_bps = int(os.getenv("HOUSE_EDGE_BPS", "500"))
    referral_bps = int(os.getenv("REFERRAL_BPS", "100"))
    jackpot_bps = int(os.getenv("JACKPOT_BPS", "150"))
    first_close_ts = int(os.getenv("JACKPOT_FIRST_CLOSE_TS", str(_next_draw_close_ts())))

    # 1. HouseTreasury
    treasury_factory = algorand.client.get_typed_app_factory(
        HouseTreasuryFactory, default_sender=deployer.address
    )
    treasury, _ = treasury_factory.send.create.create(
        args=HouseTreasuryCreateArgs(admin=deployer.address)
    )
    _fund_app(algorand, deployer.address, treasury.app_address, APP_BASE_FUNDING)
    logger.info("HouseTreasury deployed: app_id=%d address=%s", treasury.app_id, treasury.app_address)

    # Optional max-payout ceiling override (e.g. raise to 1000 = 10% on testnet so a
    # small bankroll can cover payouts; production keeps the 1% default).
    max_payout_bps = int(os.getenv("MAX_PAYOUT_BPS", "0"))
    if max_payout_bps > 0:
        treasury.send.set_max_payout_bps(args=SetMaxPayoutBpsArgs(bps=max_payout_bps))
        logger.info("max_payout_bps set to %d", max_payout_bps)

    # 2. FairJackpot (the Daily Pot vault)
    jackpot_factory = algorand.client.get_typed_app_factory(
        FairJackpotFactory, default_sender=deployer.address
    )
    jackpot, _ = jackpot_factory.send.create.create(
        args=FairJackpotCreateArgs(
            admin=deployer.address,
            beacon_app_id=beacon_app_id,
            first_close_ts=first_close_ts,
        )
    )
    # Operational float: pays ticket/page box MBR (reclaimed by cleanup()). 50 ALGO
    # covers ~1,900 first-flips-of-epoch plus pages; the keeper alerts on AccrueSkipped.
    jackpot_float = int(os.getenv("SEED_JACKPOT_FLOAT_MICROALGO", "50000000"))
    _fund_app(algorand, deployer.address, jackpot.app_address, APP_BASE_FUNDING + jackpot_float)
    logger.info(
        "FairJackpot deployed: app_id=%d address=%s first_close_ts=%d",
        jackpot.app_id,
        jackpot.app_address,
        first_close_ts,
    )

    # 3. CoinflipContract
    coinflip_factory = algorand.client.get_typed_app_factory(
        CoinflipContractFactory, default_sender=deployer.address
    )
    coinflip, _ = coinflip_factory.send.create.create(
        args=CoinflipCreateArgs(
            admin=deployer.address,
            treasury_app_id=treasury.app_id,
            beacon_app_id=beacon_app_id,
            min_bet=min_bet,
            max_bet=max_bet,
            house_edge_bps=house_edge_bps,
            referral_bps=referral_bps,
            jackpot_app_id=jackpot.app_id,
            jackpot_bps=jackpot_bps,
        ),
        app_references=[jackpot.app_id],  # create() resolves the pot's app address
    )
    _fund_app(algorand, deployer.address, coinflip.app_address, APP_BASE_FUNDING)
    logger.info(
        "CoinflipContract deployed: app_id=%d edge=%dbps referral=%dbps jackpot=%dbps",
        coinflip.app_id,
        house_edge_bps,
        referral_bps,
        jackpot_bps,
    )

    # 4. Register CoinflipContract in HouseTreasury (grouped MBR payment for the registry box).
    register_mbr = algorand.create_transaction.payment(
        PaymentParams(
            sender=deployer.address,
            receiver=treasury.app_address,
            amount=AlgoAmount(micro_algo=GAME_BOX_MBR),
        )
    )
    treasury.send.register_game(
        args=RegisterGameArgs(game_app_id=coinflip.app_id, pay=register_mbr)
    )
    logger.info("CoinflipContract registered in HouseTreasury")

    # 5. Authorize CoinflipContract to accrue tickets (FairJackpot game slot 1).
    jackpot.send.set_game(
        args=SetGameArgs(slot=1, game_app_id=coinflip.app_id),
        app_references=[coinflip.app_id],
    )
    logger.info("CoinflipContract registered in FairJackpot slot 1")

    # 6. LeaderboardContract (standalone; not wired into Coinflip).
    leaderboard_factory = algorand.client.get_typed_app_factory(
        LeaderboardContractFactory, default_sender=deployer.address
    )
    leaderboard, _ = leaderboard_factory.send.create.create(
        args=LeaderboardCreateArgs(admin=deployer.address)
    )
    _fund_app(algorand, deployer.address, leaderboard.app_address, APP_BASE_FUNDING)
    logger.info("LeaderboardContract deployed: app_id=%d", leaderboard.app_id)

    # 7. Optional initial bankroll seed.
    seed = int(os.getenv("SEED_TREASURY_MICROALGO", "0"))
    if seed > 0:
        seed_pay = algorand.create_transaction.payment(
            PaymentParams(
                sender=deployer.address,
                receiver=treasury.app_address,
                amount=AlgoAmount(micro_algo=seed),
            )
        )
        treasury.send.deposit(args=DepositArgs(pay=seed_pay))
        logger.info("Seeded HouseTreasury with %d microALGO", seed)

    # 8. Optional initial pot deposit (mainnet release: the v1 "virtual seed" =
    # coinflip_v1.total_volume * 100 // 10_000, read from chain at release time).
    pot_seed = int(os.getenv("SEED_JACKPOT_POT_MICROALGO", "0"))
    if pot_seed > 0:
        pot_pay = algorand.create_transaction.payment(
            PaymentParams(
                sender=deployer.address,
                receiver=jackpot.app_address,
                amount=AlgoAmount(micro_algo=pot_seed),
            )
        )
        jackpot.send.deposit_pot(args=DepositPotArgs(pay=pot_pay))
        logger.info("Seeded Daily Pot with %d microALGO", pot_seed)

    if network != "localnet" and beacon_app_id == 0:
        logger.warning("No VRF beacon configured for network=%s; resolve() will fail", network)

    logger.info(
        "Deploy complete. treasury=%d jackpot=%d coinflip=%d leaderboard=%d (network=%s, beacon=%d)",
        treasury.app_id,
        jackpot.app_id,
        coinflip.app_id,
        leaderboard.app_id,
        network,
        beacon_app_id,
    )


if __name__ == "__main__":
    main()
