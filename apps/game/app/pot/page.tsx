import type { Metadata } from 'next';
import { NavTabs } from '../../components/NavTabs';
import { PotBar } from '../../components/PotBar';
import { PotPageClient } from './PotPageClient';

export const metadata: Metadata = {
  title: 'Daily Pot — Fairground',
  description:
    'Every flip feeds the daily pot. VRF draw at 20:00 UTC picks the winner — 70% jackpot, five runners-up, 10% compounds. Provably fair on Algorand.',
};

export default function PotPage() {
  return (
    <>
      <div className="bg-layer" aria-hidden />
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-2xl flex-col items-center gap-6 px-4 py-8">
        <header className="flex w-full items-center justify-between gap-3">
          <a
            href="https://fairground.quest"
            className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
          >
            <span
              aria-hidden
              className="text-sm leading-none sm:text-base"
              style={{ color: 'var(--color-primary)' }}
            >
              ◆
            </span>
            <span
              className="font-bold uppercase tracking-[0.18em] text-[15px] sm:text-lg sm:tracking-[0.3em]"
              style={{
                color: 'var(--color-primary)',
                textShadow: '0 0 18px oklch(0.78 0.18 65 / 0.35)',
              }}
            >
              Fairground
            </span>
          </a>
        </header>

        <NavTabs active="pot" />

        <PotBar />

        <div className="flex w-full flex-col gap-1">
          <div
            className="font-mono text-[10px] uppercase tracking-[0.3em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Daily Pot // on-chain VRF lottery
          </div>
          <h1
            className="text-2xl font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-primary)' }}
          >
            Daily Pot
          </h1>
          <p className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Every flip feeds it. Every wallet earns tickets. VRF picks the winner — verifiable by
            anyone.
          </p>
        </div>

        <section className="w-full">
          <PotPageClient />
        </section>

        <p
          className="font-mono text-[10px] tracking-wide"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Draw params read live from on-chain state · VRF output verifiable via allo.info ·
          open-source contracts
        </p>
      </main>
    </>
  );
}
