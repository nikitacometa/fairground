# @fairground/game

Next.js 16 App Router dApp for the Fairground platform. First game: provably fair coinflip backed by the Applied Blockchain VRF beacon on Algorand.

## Stack

- Next.js 16 (App Router, strict TypeScript)
- Tailwind CSS v4 via `@tailwindcss/postcss`
- `@txnlab/use-wallet-react` v4 (Pera + Defly)
- `@fairground/sdk` — contract client + VRF helpers
- `@fairground/types` — shared Zod schemas and API types

## Setup

```bash
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID and NEXT_PUBLIC_COINFLIP_APP_ID
pnpm dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | Fairground API base URL |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes | WalletConnect Cloud project ID |
| `NEXT_PUBLIC_ALGORAND_NETWORK` | Yes | `mainnet` or `testnet` |
| `NEXT_PUBLIC_COINFLIP_APP_ID` | Yes | Deployed CoinflipContract app ID |

## Contract Client (TODO)

The `@fairground/sdk` CoinflipContractClient is not yet generated.
Run from the repo root:

```bash
pnpm contracts:build    # compile Puya → artifacts/*.arc56.json
pnpm contracts:generate # algokit generate client → packages/sdk/src/clients/
```

Then uncomment the client export in `packages/sdk/src/index.ts` and replace
the `TODO` blocks in `components/CoinflipGame.tsx` with the real typed calls.

## Game Flow

1. Connect Pera or Defly via the wallet button.
2. Pick heads or tails, enter bet amount (0.5 ALGO for v1).
3. Click Flip — sign a 2-txn atomic group (payment + app call).
4. Wait ~22s for the VRF beacon to settle (commit round + 8 + 2 buffer).
5. Result is revealed; download or share the VRF proof card.

The proof card PNG is served by `@fairground/api` at `/proof/:txnId` and cached in Redis.
