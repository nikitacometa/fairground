# Fairground smart contracts package.
# AlgoKit discovers contracts by scanning this directory; do not remove this file.
#
# Contracts:
#   house_treasury  - HouseTreasury: global pool, game registry, emergency pause.
#                     Must be deployed FIRST. All game contracts reference it.
#   coinflip        - CoinflipContract: VRF-backed coin flip, 2% house edge.
#   leaderboard     - LeaderboardContract: per-wallet stats, updated via inner calls.
