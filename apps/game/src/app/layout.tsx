import type { Metadata } from 'next';
import { WalletProvider } from '../components/WalletProvider.js';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fairground -- Provably Fair Games on Algorand',
  description: 'VRF-backed degen games. Every outcome verifiable on-chain. Powered by Applied Blockchain VRF beacon.',
  openGraph: {
    title: 'Fairground',
    description: 'Provably fair coin flips on Algorand',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
