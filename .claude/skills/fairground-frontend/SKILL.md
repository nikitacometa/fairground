---
name: fairground-frontend
description: Fairground frontend skill. Load before writing any React, Next.js, or Astro code in apps/game or apps/landing. Locks design system, wallet integration patterns, and anti-patterns.
user-invokable: true
---

# Fairground Frontend Skill

Load before writing or modifying any frontend code in `apps/game/` or `apps/landing/`.

## When to invoke

- Starting any React or Next.js work in `apps/game/`
- Starting any Astro work in `apps/landing/`
- Adding a wallet integration feature
- Writing a new component or page

## Design System

**OKLCH Palette (Tailwind 4 @theme tokens):**

| Token    | OKLCH                | Hex approx | Use                  |
| -------- | -------------------- | ---------- | -------------------- |
| bg       | oklch(0.10 0.02 30)  | #110c08    | Page background      |
| primary  | oklch(0.78 0.18 65)  | #d4963a    | CTA, headline accent |
| green    | oklch(0.72 0.18 145) | #3eb86a    | Win state, success   |
| red      | oklch(0.58 0.20 25)  | #c43030    | Loss state, error    |
| vrf-blue | oklch(0.70 0.12 240) | #5b8fd4    | VRF proof data       |
| text     | oklch(0.95 0.02 65)  | #f0e8d8    | Body text            |
| text-dim | oklch(0.65 0.08 65)  | #a0856a    | Secondary text       |

**Fonts:**

- Body/code: IBM Plex Mono (monospace -- signals precision/verifiability)
- Display: can use Geist Variable for landing headlines only

**Anti-slop check:** Fairground passes the AI Slop Test if it avoids:

- Purple-blue/cyan-on-dark gradients (generic degen casino default)
- Neon green/rainbow borders (amateur crypto aesthetic)
- Glassmorphism on game UI (trust = clarity, not effect)
- Generic card grid with icon + heading + text (corporate SaaS)

## Wallet Integration (@txnlab/use-wallet-react 4.6.0)

```tsx
// CORRECT: use useWallet() hook in client components
import { useWallet } from '@txnlab/use-wallet-react';

function GameComponent() {
  const { activeAddress, signTransactions } = useWallet();
  // ...
}

// WalletProvider setup in apps/game/src/components/WalletProvider.tsx
// WalletId.PERA, WalletId.DEFLY, WalletId.LUTE
```

**Anti-patterns:**

```tsx
// WRONG: raw algosdk group construction in components
const txn = algosdk.makePaymentTxnWithSuggestedParams(...);

// WRONG: useEffect for wallet state (use-wallet handles this)
useEffect(() => { setConnected(wallet.isConnected); }, [wallet]);
```

**All txn group construction in @fairground/sdk generated clients:**

```typescript
// CORRECT: go through generated client
import { CoinflipContractClient } from '@fairground/sdk';
const result = await client.flip({ salt_hash, referrer }, { signer: signTransactions });
```

## Proof Card Share Intent

```typescript
const tweetText =
  outcome === 'heads'
    ? `Just won ${algoAmount} ALGO on @fairground 🪙 VRF round #${vrfRound} -- provably fair on Algorand`
    : `Flipped TAILS on @fairground 🪙 VRF round #${vrfRound} -- next time`;

const proofUrl = `https://api.fairground.xyz/proof/${txnId}`;
const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(proofUrl)}`;
```

## iOS WalletConnect Revival

Use `useRelayerWake()` hook in `apps/game/src/hooks/useRelayerWake.ts`.
It listens for `visibilitychange` and `pageshow(persisted)` to call `manager.resumeSessions()`.
Include it in WalletProvider via `RelayerWakeActivator` sub-component.

Without this: transactions silently fail on iOS when user switches to Pera/Defly and back.

## Mobile Deep Links

```typescript
// Open wallet app after initiating WC session on mobile
import { WALLET_DEEP_LINKS } from '../hooks/useRelayerWake.js';

// iOS Pera
window.location.href = WALLET_DEEP_LINKS.pera.ios;
// iOS Defly
window.location.href = WALLET_DEEP_LINKS.defly.ios;
```

## Component Rules

1. No raw algosdk in JSX components -- all txns through @fairground/sdk
2. No useEffect for wallet state -- use-wallet-react handles subscriptions
3. No Reach stdlib patterns -- Puya only
4. BigInt serialization: API returns bigints as strings; parse with `BigInt(str)` in components
5. All bet amounts displayed in ALGO (divide microALGO by 1_000_000)

## Next.js App Router Conventions (apps/game)

- `'use client'` required on any component using hooks (useWallet, useState, etc.)
- RSC for leaderboard and history pages (no client bundle = faster load)
- `env.ts` at apps/game level for runtime env validation
- `NEXT_PUBLIC_` prefix for browser-accessible env vars

## Astro Conventions (apps/landing)

- Static output (`output: 'static'`)
- React islands only where interactivity needed (`.tsx` with `client:load` directive)
- Tailwind 4 via `@tailwindcss/vite` plugin (no PostCSS config needed)
- BaseLayout.astro: grain overlay, ember cursor trail, Plausible analytics
