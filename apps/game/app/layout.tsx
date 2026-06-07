import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL('https://app.fairground.quest'),
  title: 'Fairground — Provably Fair Games on Algorand',
  description:
    'Coinflip powered by VRF randomness. Bet ALGO, get a verifiable proof card. Every result is on-chain.',
  openGraph: {
    title: 'Fairground',
    description: 'Provably fair degen games on Algorand.',
    type: 'website',
    url: 'https://app.fairground.quest',
    images: [
      { url: '/og.png', width: 1600, height: 900, alt: 'Fairground — provably fair on Algorand' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@FairgroundHQ',
    title: 'Fairground',
    description: 'Provably fair degen games on Algorand.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh bg-[--color-bg] text-[--color-text] font-mono antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
