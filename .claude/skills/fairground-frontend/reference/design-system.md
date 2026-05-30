# Fairground Design System

---

## Brand Direction

**Provably fair. Visibly serious.** The design must pass the AI Slop Test: a player arriving from a VRF proof card tweet should feel they landed on a serious technical product, not a generic degen casino. The provably-fair trust signal is the marketing budget — the UI must not undermine it.

Fairground passes the AI Slop Test if it avoids the defaults used by generic degen casino sites:
- No purple-to-blue gradients
- No cyan-on-dark color schemes
- No neon glow on everything
- No glassmorphism card effects on the primary UI
- No Inter or Roboto as the primary typeface

The aesthetic target: dark amber. Think "precision instrument under dim light" — honest, readable, warm. Not casino, not fintech, not generic Web3.

---

## OKLCH Color Palette

All colors use OKLCH for perceptual uniformity. Define as CSS custom properties.

```css
:root {
  /* Backgrounds */
  --bg-base:       oklch(0.10 0.02 30);   /* near-black warm */
  --bg-surface:    oklch(0.14 0.02 30);   /* card surface */
  --bg-elevated:   oklch(0.18 0.02 30);   /* modal / popover */
  --bg-border:     oklch(0.22 0.02 30);   /* subtle border */

  /* Amber-gold primary */
  --primary:       oklch(0.78 0.18 65);   /* amber gold — buttons, highlights */
  --primary-hover: oklch(0.82 0.20 65);   /* lighter on hover */
  --primary-dim:   oklch(0.65 0.12 65);   /* muted state */

  /* Semantic */
  --win-green:     oklch(0.72 0.18 145);  /* player win state */
  --loss-red:      oklch(0.58 0.20 25);   /* player loss state */
  --vrf-blue:      oklch(0.70 0.12 240);  /* VRF proof accent — use sparingly */

  /* Text */
  --text-primary:  oklch(0.96 0.01 80);   /* main text — warm white */
  --text-muted:    oklch(0.65 0.02 60);   /* secondary text */
  --text-disabled: oklch(0.42 0.01 60);   /* disabled state */
}
```

In Tailwind 4, register these as design tokens in `tailwind.config.ts`:
```ts
theme: {
  extend: {
    colors: {
      'fg-base':    'oklch(0.10 0.02 30)',
      'fg-primary': 'oklch(0.78 0.18 65)',
      'fg-win':     'oklch(0.72 0.18 145)',
      'fg-loss':    'oklch(0.58 0.20 25)',
      'fg-vrf':     'oklch(0.70 0.12 240)',
    },
  },
}
```

---

## Typography

- **Primary typeface:** Space Grotesk (Google Fonts) — geometric, technical, distinctive without being loud
- **Mono (proof card, VRF output):** JetBrains Mono — only for hash/address display
- **Font sizes:** Tailwind defaults (text-sm through text-4xl). No custom size scale.
- **Line height:** 1.5 for body, 1.2 for headings.
- **Letter spacing:** -0.02em on headings larger than 2xl.

---

## Taste Dials (locked)

| Dial | Value | Meaning |
|------|-------|---------|
| DESIGN_VARIANCE | 7/10 | Asymmetric, memorable — not generic SaaS center-stack |
| MOTION_INTENSITY | 5/10 | Purposeful — coin flip animation, VRF proof reveal, proof card pop-in |
| VISUAL_DENSITY | 6/10 | Content-rich. The game canvas + real-time state requires density |
| STYLE VARIANT | technical dark | Amber-gold on near-black. Editorial structure. |

---

## Wallet Integration (@txnlab/use-wallet-react v4.6.0)

### Correct pattern

```tsx
// apps/game/src/components/FlipButton.tsx
'use client';

import { useWallet } from '@txnlab/use-wallet-react';

export function FlipButton({ betAmount }: { betAmount: bigint }) {
  const { activeAccount, signTransactions } = useWallet();

  const handleFlip = async () => {
    if (!activeAccount) return;
    // All transaction construction in @fairground/sdk — never here
    const { txns } = await buildFlipTransaction({
      player: activeAccount.address,
      betAmount,
    });
    const signed = await signTransactions(txns);
    await submitFlip(signed);
  };

  return (
    <button onClick={handleFlip} disabled={!activeAccount}>
      Flip {betAmount / 1_000_000n} ALGO
    </button>
  );
}
```

### Anti-pattern

```tsx
// NEVER do this in a component:
import algosdk from 'algosdk'; // blocked in components
const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ ... });
```

---

## iOS Relayer-Wake Hook (useRelayerWake)

Pera and Defly on iOS suspend the WalletConnect relay when the user switches to the wallet app to sign. The relay must be woken when the user returns to the browser tab.

Port this pattern from `metafarm-frontend/src/providers/walletConnectService.ts`:

```tsx
// packages/sdk/src/hooks/useRelayerWake.ts
import { useEffect } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';

export function useRelayerWake(): void {
  const { manager } = useWallet();

  useEffect(() => {
    const wake = () => {
      // Force WalletConnect relay reconnection on tab focus / page restore
      manager?.getWalletById('pera')?.reconnect?.();
      manager?.getWalletById('defly')?.reconnect?.();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') wake();
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) wake(); // bfcache restore
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [manager]);
}
```

Import `useRelayerWake()` in the game root layout — it runs once and handles all wallet types.

---

## Mobile Deep-Link Constants

When a wallet is not installed, redirect to the app store or deep-link to the wallet app.

```typescript
// packages/sdk/src/constants/deepLinks.ts
export const WALLET_DEEP_LINKS = {
  pera: {
    ios: 'perawallet-wc://',         // opens Pera iOS with WC URI
    android: '',                       // Android uses raw WC URI
    appStore: 'https://apps.apple.com/app/pera-algo-wallet/id1459905340',
    playStore: 'https://play.google.com/store/apps/details?id=com.algorand.android',
  },
  defly: {
    ios: 'defly-wc://',               // opens Defly iOS with WC URI
    android: '',                       // Android uses raw WC URI
    appStore: 'https://apps.apple.com/app/defly-algo-wallet/id1602672723',
    playStore: 'https://play.google.com/store/apps/details?id=io.blockshake.defly',
  },
} as const;
```

On mobile, after generating the WC URI, attempt `window.location = WALLET_DEEP_LINKS.pera.ios + wcUri`. If the app is not installed, fall back to the app store link after a 2-second timeout.

---

## Proof Card Share Intent

Every resolved flip generates a proof card PNG via `api.fairground.xyz/proof/:txnId`. The share button opens a pre-filled tweet.

```typescript
// URL template
export function buildShareIntent(params: {
  txnId: string;
  outcome: 'win' | 'loss';
  betAmountAlgo: number;
  payoutAlgo: number;
}): string {
  const { txnId, outcome, betAmountAlgo, payoutAlgo } = params;

  const text = outcome === 'win'
    ? `Just won ${payoutAlgo} ALGO on Fairground — VRF proof on-chain. 🤝\n#Algorand #ProvablyFair`
    : `Lost ${betAmountAlgo} ALGO on Fairground — proof on-chain.\n#Algorand #ProvablyFair`;

  const proofUrl = `https://api.fairground.xyz/proof/${txnId}`;

  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(proofUrl)}`;
}
```

The `proofUrl` must be publicly accessible before any game goes live — Twitter card preview crawlers hit it at tweet time.

---

## Anti-Pattern Summary

| Pattern | Why banned |
|---------|-----------|
| `import algosdk from 'algosdk'` in component files | All txn construction in `@fairground/sdk` |
| `useEffect` for wallet state | `useWallet()` hooks are reactive — no effect needed |
| Purple/blue/cyan/neon colors | Generic casino look destroys trust signal |
| Glassmorphism on primary UI | Overused, looks unserious |
| Gradient text on metrics | AI slop tell, reduces readability |
| Uniform icon-heading-text card grids | Generic, forgettable |
| `import * from '@reach/stdlib'` | Reach is dead. Puya only. |
| `as any` in component files | Use proper types from `@fairground/types` |
| `useEffect` on `useWallet()` return values | Race condition on mobile reconnect |
