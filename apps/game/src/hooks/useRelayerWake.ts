'use client';

import { useEffect } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';

/**
 * useRelayerWake -- iOS WalletConnect session revival hook.
 *
 * Ported from cometa/metafarm-frontend/src/services/walletConnectService.ts.
 * On iOS, Safari suspends the WC relayer WebSocket when the user switches to
 * their wallet app and back. The session appears connected but transactions fail
 * because the relayer is not actually sending.
 *
 * Fix: listen for visibilitychange (tab focus) and pageshow (page restored from
 * bfcache) events. When triggered, call manager.resumeSessions() to reconnect
 * any suspended WC relayer connections.
 *
 * @txnlab/use-wallet-react 4.6.0: useWallet() exposes { manager } which is the
 * WalletManager instance. WalletManager has resumeSessions() for exactly this purpose.
 */
export function useRelayerWake(): void {
  const { manager } = useWallet();

  useEffect(() => {
    if (!manager) return;

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        // Resume any suspended WalletConnect relayer connections
        manager.resumeSessions().catch((err: unknown) => {
          console.warn('[useRelayerWake] resumeSessions error:', err);
        });
      }
    };

    const handlePageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        // Page restored from bfcache (iOS back button navigation)
        manager.resumeSessions().catch((err: unknown) => {
          console.warn('[useRelayerWake] resumeSessions (pageshow) error:', err);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [manager]);
}

/**
 * Mobile deep-link constants for Algorand wallets.
 * Use these to open the wallet app on mobile after initiating a WC session.
 */
export const WALLET_DEEP_LINKS = {
  pera: {
    ios: 'perawallet-wc://',
    android: 'wc://',  // WC URI on Android
  },
  defly: {
    ios: 'defly-wc://',
    android: 'wc://',
  },
} as const;
