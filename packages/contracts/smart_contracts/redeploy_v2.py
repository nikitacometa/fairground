"""
One-off mainnet release deploy for FairJackpot + Coinflip v2.

Reuses the LIVE HouseTreasury (3584287403) — does not create a new one. Deploys the
FairJackpot vault and Coinflip v2 (edge in global state), registers v2 in the treasury,
authorizes v2 as the pot's game slot 1, funds the pot float, and seeds the pot with the
migrated v1 "virtual" seed (1% of v1 settled volume).

Run (mainnet):
    DEPLOYER_MNEMONIC / ALGOD_SERVER / ALGORAND_NETWORK set by the wrapper
    HOUSE_EDGE_BPS=500 REFERRAL_BPS=100 JACKPOT_BPS=150
    JACKPOT_FIRST_CLOSE_TS=<unix>   # short for the smoke, or next 20:00 UTC for prod
    SEED_JACKPOT_FLOAT_MICROALGO=20000000
    SEED_JACKPOT_POT_MICROALGO=<v1 total_volume * 100 // 10000>
    python -m smart_contracts.redeploy_v2

Excluded house wallets are NOT set here (the smoke flips from the deployer and needs a
ticket); call set_excluded after the smoke draw.
"""

import logging
import os

import algokit_utils
from algokit_utils import AlgoAmount, AlgorandClient, PaymentParams

from smart_contracts.coinflip.coinflip_client import (
    CoinflipContractFactory,
    CreateArgs as CoinflipCreateArgs,
)
from smart_contracts.fairjackpot.fairjackpot_client import (
    CreateArgs as JackpotCreateArgs,
    DepositPotArgs,
    FairJackpotFactory,
    SetGameArgs,
)
from smart_contracts.house_treasury.house_treasury_client import (
    HouseTreasuryFactory,
    RegisterGameArgs,
)

logger = logging.getLogger(__name__)

TREASURY_APP_ID = 3_584_287_403
BEACON_APP_ID = 1_615_566_206
GAME_BOX_MBR = 20_500
APP_BASE_FUNDING = 300_000


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    algorand = AlgorandClient.from_environment()
    algorand.set_default_validity_window(1000)
    deployer = algorand.account.from_environment("DEPLOYER")

    edge = int(os.environ["HOUSE_EDGE_BPS"])
    referral = int(os.getenv("REFERRAL_BPS", "100"))
    jackpot_bps = int(os.getenv("JACKPOT_BPS", "150"))
    min_bet = int(os.getenv("MIN_BET_MICROALGO", "100000"))
    max_bet = int(os.getenv("MAX_BET_MICROALGO", "20000000"))
    first_close_ts = int(os.environ["JACKPOT_FIRST_CLOSE_TS"])
    float_micro = int(os.getenv("SEED_JACKPOT_FLOAT_MICROALGO", "20000000"))
    pot_seed = int(os.getenv("SEED_JACKPOT_POT_MICROALGO", "0"))

    # 1. FairJackpot vault (resumable: reuse an already-deployed pot via JACKPOT_APP_ID)
    jf = algorand.client.get_typed_app_factory(
        FairJackpotFactory, default_sender=deployer.address
    )
    existing_jackpot = int(os.getenv("JACKPOT_APP_ID", "0"))
    if existing_jackpot:
        jackpot = jf.get_app_client_by_id(app_id=existing_jackpot)
        logger.info("Reusing FairJackpot app_id=%d addr=%s", jackpot.app_id, jackpot.app_address)
    else:
        jackpot, _ = jf.send.create.create(
            args=JackpotCreateArgs(
                admin=deployer.address,
                beacon_app_id=BEACON_APP_ID,
                first_close_ts=first_close_ts,
            )
        )
        algorand.send.payment(
            PaymentParams(
                sender=deployer.address,
                receiver=jackpot.app_address,
                amount=AlgoAmount(micro_algo=APP_BASE_FUNDING + float_micro),
            )
        )
        logger.info("FairJackpot deployed: app_id=%d addr=%s", jackpot.app_id, jackpot.app_address)

    # 2. Coinflip v2 (economics in global state; pot stream wired via jackpot_app_id)
    cf = algorand.client.get_typed_app_factory(
        CoinflipContractFactory, default_sender=deployer.address
    )
    coinflip, _ = cf.send.create.create(
        args=CoinflipCreateArgs(
            admin=deployer.address,
            treasury_app_id=TREASURY_APP_ID,
            beacon_app_id=BEACON_APP_ID,
            min_bet=min_bet,
            max_bet=max_bet,
            house_edge_bps=edge,
            referral_bps=referral,
            jackpot_app_id=jackpot.app_id,
            jackpot_bps=jackpot_bps,
        ),
        params=algokit_utils.CommonAppCallCreateParams(app_references=[jackpot.app_id]),
    )
    algorand.send.payment(
        PaymentParams(
            sender=deployer.address,
            receiver=coinflip.app_address,
            amount=AlgoAmount(micro_algo=APP_BASE_FUNDING),
        )
    )
    logger.info(
        "Coinflip v2 deployed: app_id=%d edge=%dbps referral=%dbps jackpot=%dbps",
        coinflip.app_id,
        edge,
        referral,
        jackpot_bps,
    )

    # 3. Register v2 in the live treasury (grouped MBR payment for the registry box)
    treasury_factory = algorand.client.get_typed_app_factory(
        HouseTreasuryFactory, default_sender=deployer.address
    )
    treasury = treasury_factory.get_app_client_by_id(app_id=TREASURY_APP_ID)
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
    logger.info("Coinflip v2 registered in live treasury %d", TREASURY_APP_ID)

    # 4. Authorize v2 as the pot's accrue caller (game slot 1)
    jackpot.send.set_game(
        args=SetGameArgs(slot=1, game_app_id=coinflip.app_id),
        params=algokit_utils.CommonAppCallParams(app_references=[coinflip.app_id]),
    )
    logger.info("Coinflip v2 set as FairJackpot game slot 1")

    # 5. Seed the pot with the migrated v1 virtual seed (1% of v1 volume)
    if pot_seed > 0:
        pot_pay = algorand.create_transaction.payment(
            PaymentParams(
                sender=deployer.address,
                receiver=jackpot.app_address,
                amount=AlgoAmount(micro_algo=pot_seed),
            )
        )
        jackpot.send.deposit_pot(args=DepositPotArgs(pay=pot_pay))
        logger.info("Seeded pot with %d microALGO", pot_seed)

    logger.info(
        "RELEASE-IDS jackpot=%d coinflip_v2=%d treasury=%d close=%d",
        jackpot.app_id,
        coinflip.app_id,
        TREASURY_APP_ID,
        first_close_ts,
    )
    print(
        f"RELEASE_IDS JACKPOT_APP_ID={jackpot.app_id} COINFLIP_V2_APP_ID={coinflip.app_id} "
        f"JACKPOT_APP_ADDR={jackpot.app_address} COINFLIP_V2_ADDR={coinflip.app_address}"
    )


if __name__ == "__main__":
    main()
