'use client';

import { WalletProvider, WalletManager, WalletId, NetworkId } from '@txnlab/use-wallet-react';
import { NfdProvider } from '@fairground/nfd/react';
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

// E2E harness: when NEXT_PUBLIC_E2E=1, enable use-wallet's Mnemonic wallet so Playwright can
// connect + sign programmatically (no Pera/Defly device prompt). This is how the full on-chain
// flow is tested without a human tapping a wallet. NEVER enabled on the production build; the
// Mnemonic wallet also refuses mainnet, so force TestNet when it is active.
const e2e = process.env['NEXT_PUBLIC_E2E'] === '1';

const manager = new WalletManager({
  // Pera and Defly use their native SDKs (no WalletConnect projectId needed).
  wallets: e2e
    ? [WalletId.MNEMONIC, WalletId.PERA, WalletId.DEFLY]
    : [WalletId.PERA, WalletId.DEFLY],
  // use-wallet v4: defaultNetwork + built-in AlgoNode algod defaults for testnet/mainnet.
  defaultNetwork: e2e ? NetworkId.TESTNET : network,
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider manager={manager}>
      <NfdProvider>{children}</NfdProvider>
    </WalletProvider>
  );
}
