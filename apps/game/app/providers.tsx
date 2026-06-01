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
  // Pera and Defly use their native SDKs (no WalletConnect projectId needed).
  wallets: [WalletId.PERA, WalletId.DEFLY],
  // use-wallet v4: defaultNetwork + built-in AlgoNode algod defaults for testnet/mainnet.
  defaultNetwork: network,
});

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider manager={manager}>{children}</WalletProvider>;
}
