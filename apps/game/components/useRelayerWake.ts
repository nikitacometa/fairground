'use client';

/**
 * useRelayerWake — re-activates the WalletConnect WebSocket relayer when
 * the tab returns to the foreground on mobile (iOS Safari suspends WS
 * connections when the app is backgrounded).
 *
 * Triggers on:
 *   - document visibilitychange (hidden → visible)
 *   - window pageshow with persisted=true (bfcache restoration)
 *
 * Strategy: nudge every active wallet to reconnect if it exposes a
 * `reconnect()` method (WalletConnect-based wallets do), otherwise
 * no-op gracefully. The use-wallet v4 wallet interface does not guarantee
 * a `reconnect` method on all adapters, so we guard with optional chaining.
 */

import { useWallet } from '@txnlab/use-wallet-react';
import { useEffect } from 'react';

export function useRelayerWake(): void {
  const { wallets } = useWallet();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const wake = () => {
      for (const wallet of wallets) {
        if (!wallet.isConnected) continue;
        // WalletConnect-based adapters (Pera, Defly) expose reconnect.
        // The v4 type does not declare it at the interface level — cast safely.
        const w = wallet as unknown as { reconnect?: () => Promise<void> };
        if (typeof w.reconnect === 'function') {
          w.reconnect().catch(() => {
            // Reconnect failed — silently swallow; the user will see the wallet
            // as disconnected and can reconnect manually.
          });
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') wake();
    };

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) wake();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [wallets]);
}
