'use client';

/**
 * /demo — wallet-free walkthrough of the full coinflip experience.
 *
 * Renders the real CoinflipGame in demo mode (forced outcome, shortened VRF wait, no
 * chain interaction) so the whole flow — idle coin, flip, VRF block ticker, win/loss
 * reveal with confetti — can be played and screenshotted without a wallet.
 */

import { useState } from 'react';
import { CoinflipGame } from '../../components/CoinflipGame';

export default function DemoPage() {
  const [outcome, setOutcome] = useState<'win' | 'loss'>('win');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-start gap-6 px-4 py-10">
      <header className="flex w-full max-w-lg items-center justify-between">
        <span
          className="text-lg font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-primary)' }}
        >
          Fairground
        </span>
        <span
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          demo
        </span>
      </header>

      <div className="flex gap-3">
        {(['win', 'loss'] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOutcome(o)}
            className="rounded border px-4 py-2 text-xs font-semibold uppercase tracking-widest"
            style={{
              borderColor: outcome === o ? 'var(--color-primary)' : 'var(--color-border)',
              color: outcome === o ? 'var(--color-primary)' : 'var(--color-text-muted)',
              background: outcome === o ? 'var(--color-primary-dim)' : 'transparent',
            }}
          >
            force {o}
          </button>
        ))}
      </div>

      <section className="w-full max-w-lg">
        {/* key remounts the game (back to idle) when the forced outcome changes */}
        <CoinflipGame key={outcome} demoOutcome={outcome} />
      </section>
    </main>
  );
}
