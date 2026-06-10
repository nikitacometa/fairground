import type { Metadata } from 'next';
import { NavTabs } from '../../components/NavTabs';
import { StatsStrip } from '../../components/StatsStrip';
import { LiveFeed } from '../../components/LiveFeed';

export const metadata: Metadata = {
  title: 'Live Feed — Fairground',
  description:
    'Every coin flip on Fairground, live. Each result links its on-chain VRF transaction — verify any of them yourself.',
};

export default function FeedPage() {
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

        <NavTabs active="feed" />

        <div className="flex w-full flex-col gap-1">
          <div
            className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <span className="live-dot" aria-hidden />
            <span style={{ color: 'var(--color-win)' }}>live</span> · coinflip // public ledger
          </div>
          <h1
            className="text-2xl font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-primary)' }}
          >
            Every Flip
          </h1>
          <p className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Real bets, as they resolve. Each row links its VRF transaction — verify any of them.
          </p>
        </div>

        <StatsStrip />

        <section className="w-full">
          <LiveFeed />
        </section>

        <p
          className="font-mono text-[10px] tracking-wide"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Net result shown (payout − stake) · names via NFD · updates every few seconds
        </p>
      </main>
    </>
  );
}
