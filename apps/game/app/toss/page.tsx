'use client';

/** /toss — dev preview of the 10 coin-toss animations (looping). */
import { useState } from 'react';
import { CoinTossScene } from '../../components/CoinTossScene';

export default function TossPreview() {
  const [variant, setVariant] = useState(0);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <h1
        className="text-sm font-bold uppercase tracking-[0.3em]"
        style={{ color: 'var(--color-text-muted)' }}
      >
        coin toss · variant {variant}
      </h1>
      <div className="flex items-center justify-center" style={{ minHeight: '16rem' }}>
        <CoinTossScene variant={variant} />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <button
            key={i}
            onClick={() => setVariant(i)}
            className="rounded border px-3 py-1 text-xs font-mono"
            style={{
              borderColor: variant === i ? 'var(--color-primary)' : 'var(--color-border)',
              color: variant === i ? 'var(--color-primary)' : 'var(--color-text-muted)',
              background: variant === i ? 'var(--color-primary-dim)' : 'transparent',
            }}
          >
            {i}
          </button>
        ))}
      </div>
    </main>
  );
}
