/**
 * Astro island for the hero: a live coin endlessly tossed, cycling through the 10 toss
 * styles every 8s so the hero reads as a running protocol console. client:load.
 *
 * Uses the compact `md` grid on phones (the `lg` 60-char grid overflows narrow viewports)
 * and the cinematic `lg` grid from the `sm` breakpoint up.
 */
import { useEffect, useState } from 'react';
import { CoinTossScene } from './CoinTossScene';

export default function AsciiTossIsland() {
  const [variant, setVariant] = useState(0);
  const [size, setSize] = useState<'md' | 'lg'>('lg');

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const applySize = (): void => setSize(mq.matches ? 'md' : 'lg');
    applySize();
    mq.addEventListener('change', applySize);

    const id = setInterval(() => setVariant((prev) => (prev + 1) % 10), 8000);
    return () => {
      mq.removeEventListener('change', applySize);
      clearInterval(id);
    };
  }, []);

  return <CoinTossScene variant={variant} size={size} />;
}
