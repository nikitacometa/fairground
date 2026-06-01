# Fairground Wallet Integration (@txnlab/use-wallet-react 4.6.0)

Companion to `design-system.md`. Patterns for connecting wallets, signing, and surviving iOS WalletConnect suspension. **Rule: no raw `algosdk` in components — all transaction construction lives in `@fairground/sdk` generated clients.**

## Provider setup (App Router)

`use-wallet` v4 uses a `WalletManager`. Configure it once in `apps/game/app/providers.tsx` (a client component), wrapping the app in `<WalletProvider manager={…}>`. Supported wallets: Pera (native `@perawallet/connect`, not raw WC v2), Defly, Lute, Kibisis, Exodus. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is required at build time (register at cloud.walletconnect.com — see Open Question #7).

## Correct usage

```tsx
'use client';
import { useWallet } from '@txnlab/use-wallet-react';

export function FlipButton({ betAmount, pick }: { betAmount: bigint; pick: 'heads' | 'tails' }) {
  const { activeAccount, signTransactions } = useWallet();

  const handleFlip = async () => {
    if (!activeAccount) return;
    // Transaction group built by the generated SDK client — never algosdk here.
    const { txns } = await buildFlipTransaction({ player: activeAccount.address, betAmount, pick });
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

## Anti-patterns (banned)

- `import algosdk from 'algosdk'` in a component → all group construction in `@fairground/sdk`.
- `useEffect` syncing wallet state → `useWallet()` is already reactive.
- `Buffer.from(...)` in browser code → **Buffer is Node-only**; use `Uint8Array` / `TextEncoder` (the scaffold's `CoinflipGame.tsx:184` is a real bug).

## iOS relayer-wake — already implemented

`apps/game/components/useRelayerWake.ts` exists and is wired into `CoinflipGame.tsx`. Pera/Defly on iOS suspend the WC relay when the user switches to the wallet app to sign; the hook listens for `visibilitychange` + `pageshow(persisted)` (bfcache) and calls `wallet.reconnect()` through the v4 adapter. This is safer than metafarm's raw `relayer.restartTransport()` on WC SignClient internals — **do not "port" it again, it's done.** Keep it mounted once in the game root.

```tsx
const wake = () => {
  manager?.getWallet(WalletId.PERA)?.reconnect?.();
  manager?.getWallet(WalletId.DEFLY)?.reconnect?.();
};
// visibilitychange (visible) + pageshow (e.persisted) → wake()
```

## Mobile deep links

`WALLET_DEEP_LINKS` (Pera iOS `perawallet-wc://`, Defly iOS `defly-wc://`, Android uses the raw WC URI). After generating the WC URI on mobile, attempt `window.location = link + wcUri`; fall back to the App/Play Store link after a ~2s timeout if the app isn't installed.

## BigInt discipline in the UI

API returns `bigint` as strings; parse with `BigInt(str)`. Display ALGO by dividing microALGO by `1_000_000n`. The per-flip box MBR the payment must cover is **49,700 microALGO** (`BOX_MBR = 49_700n`) — matches `coinflip/contract.py`. The scaffold's `36_900n` is stale (pre-`referrer`) and will revert every flip.
