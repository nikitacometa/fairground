'use client';

import { WalletProvider as UseWalletProvider, WalletManager, WalletId } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';
import { useRelayerWake } from '../hooks/useRelayerWake.js';

const ALGOD_URL = process.env['NEXT_PUBLIC_API_URL']
  ? `${process.env['NEXT_PUBLIC_API_URL']}/algod-proxy`
  : 'https://mainnet-api.algonode.cloud';

const algodClient = new algosdk.Algodv2('', ALGOD_URL, '');

const manager = new WalletManager({
  wallets: [
    WalletId.PERA,
    WalletId.DEFLY,
    WalletId.LUTE,
  ],
  algod: {
    baseServer: ALGOD_URL,
    port: '',
    token: '',
    network: 'mainnet',
  },
  options: {
    walletConnect: {
      projectId: process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? '',
    },
  },
});

function RelayerWakeActivator(): null {
  useRelayerWake();
  return null;
}

interface Props {
  children: React.ReactNode;
}

/**
 * WalletProvider -- wraps the app with @txnlab/use-wallet-react 4.6.0.
 *
 * Place this at the top of your layout tree (app/layout.tsx).
 * Includes the iOS WC relayer wake hook.
 *
 * All transaction group construction happens in @fairground/sdk generated clients.
 * Components call useWallet().signTransactions() -- never raw algosdk in JSX.
 */
export function WalletProvider({ children }: Props): React.ReactElement {
  return (
    <UseWalletProvider manager={manager}>
      <RelayerWakeActivator />
      {children}
    </UseWalletProvider>
  );
}
