'use client';

import { WalletProvider, WalletManager, WalletId, NetworkId } from '@txnlab/use-wallet-react';
import type { ReactNode } from 'react';

function buildNetworkId(raw: string | undefined): NetworkId {
  switch (raw) {
    case 'mainnet':
      return NetworkId.MAINNET;
    case 'testnet':
      return NetworkId.TESTNET;
    case 'betanet':
      return NetworkId.BETANET;
    default:
      return NetworkId.TESTNET;
  }
}

const network = buildNetworkId(process.env['NEXT_PUBLIC_ALGORAND_NETWORK']);

const manager = new WalletManager({
  wallets: [
    {
      id: WalletId.PERA,
      options: {
        projectId: process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? '',
      },
    },
    {
      id: WalletId.DEFLY,
      options: {
        projectId: process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? '',
      },
    },
  ],
  network,
  algod: {
    token: '',
    baseServer:
      network === NetworkId.MAINNET
        ? 'https://mainnet-api.algonode.cloud'
        : 'https://testnet-api.algonode.cloud',
    port: 443,
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider manager={manager}>{children}</WalletProvider>;
}
