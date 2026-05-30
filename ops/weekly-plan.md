# Fairground Weekly Plan

**Week of:** 2026-06-01 (update each Monday)
**Phase:** Pre-launch -- CometaFlip v1 (Days 1-14 roadmap)

## This Week

### Blockers (resolve first)
- [ ] Compile Puya contracts: `cd packages/contracts && algokit compile python smart_contracts/`
- [ ] Generate TypeScript clients: `algokit generate client packages/contracts/artifacts/ --output packages/sdk/src/clients/`
- [ ] Verify testnet beacon app ID 110096026 via algorand MCP before integration tests
- [ ] WalletConnect Project ID registration at cloud.walletconnect.com

### P0 -- Launch blockers
- [ ] Contract compilation passes (all three contracts: coinflip, house_treasury, leaderboard)
- [ ] Geo-block live (Cloudflare Workers or API middleware) -- TH block verified
- [ ] House treasury funded with 2000+ ALGO on testnet
- [ ] Keeper running on testnet, resolving test sessions within 60 minutes
- [ ] Proof card PNG generation working (fonts in packages/proof-card/assets/fonts/)

### P1 -- Launch quality
- [ ] CoinflipGame component wired to real generated SDK client
- [ ] WS subscription working end-to-end (keeper -> Redis pub/sub -> frontend)
- [ ] Leaderboard rendering real data
- [ ] Landing deployed to fairground.xyz

### P2 -- Post-launch
- [ ] Open-source contracts (for xGov retroactive eligibility)
- [ ] Proof card share flow verified on mobile (Pera deep-link + iOS bfcache revival)
- [ ] Monitor beacon retention: alert if sessions approach 60-min resolution window

## Calendar

| Date | Event |
|------|-------|
| Week 1 | Contract compilation, testnet deploy, keeper SLA test |
| Week 2 | Frontend wiring, landing live, first real testnet flip |
| Week 3 | Mainnet deploy with 2000 ALGO seed, private beta (5 testers) |
| Week 4 | Geo-block verification, Foundation prep |
| Week 6 | Public launch + Foundation RT request |

## Links

- Game dApp: https://app.fairground.xyz (not live yet)
- API: https://api.fairground.xyz (not live yet)
- Landing: https://fairground.xyz (not live yet)
- VRF Beacon: https://algoexplorer.io/application/947957720
