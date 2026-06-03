/**
 * FloatingCoins — a depth-tiered field of ASCII coins drifting slowly behind all content,
 * giving the dark canvas ambient life. Three tiers (near / mid / ghost) with per-coin
 * scale + opacity + wander path; blur scales inversely with size for a free depth illusion.
 * Reuses the signature coin renderer. Gated: fewer on small/weak devices, none under
 * prefers-reduced-motion. Mounted once in BaseLayout (client:idle), behind the page.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { AsciiCoin } from './AsciiCoin';

interface Drifter {
  left: string;
  top: string;
  scale: number;
  op: number;
  dur: number;
  delay: number;
  dx: number;
  dy: number;
}

// Ordered most-visible first, so the mobile slice keeps the best ones.
const COINS: Drifter[] = [
  // near-field
  { left: '12%', top: '22%', scale: 0.85, op: 0.18, dur: 46, delay: 0, dx: 48, dy: -30 },
  { left: '70%', top: '30%', scale: 0.78, op: 0.16, dur: 54, delay: -12, dx: -44, dy: 36 },
  { left: '56%', top: '70%', scale: 0.9, op: 0.17, dur: 50, delay: -26, dx: 40, dy: -40 },
  // mid-field
  { left: '30%', top: '58%', scale: 0.55, op: 0.11, dur: 62, delay: -8, dx: 54, dy: 44 },
  { left: '80%', top: '60%', scale: 0.5, op: 0.1, dur: 48, delay: -18, dx: -50, dy: -34 },
  { left: '6%', top: '66%', scale: 0.6, op: 0.12, dur: 58, delay: -30, dx: 46, dy: -50 },
  { left: '44%', top: '14%', scale: 0.48, op: 0.09, dur: 66, delay: -40, dx: -38, dy: 48 },
  // ghost-field
  { left: '22%', top: '40%', scale: 0.32, op: 0.05, dur: 70, delay: -5, dx: 30, dy: 40 },
  { left: '64%', top: '46%', scale: 0.3, op: 0.05, dur: 64, delay: -22, dx: -34, dy: -28 },
  { left: '40%', top: '86%', scale: 0.34, op: 0.06, dur: 58, delay: -36, dx: 36, dy: -30 },
];

export default function FloatingCoins() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const weak = window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 4) < 4;
    setCount(weak ? 4 : COINS.length);
  }, []);

  if (count === 0) return null;

  return (
    <div aria-hidden className="floating-coins">
      {COINS.slice(0, count).map((c, i) => (
        <div
          key={i}
          className="floating-coin"
          style={
            {
              left: c.left,
              top: c.top,
              '--scale': `${c.scale}`,
              '--op': `${c.op}`,
              '--dur': `${c.dur}s`,
              '--delay': `${c.delay}s`,
              '--dx': `${c.dx}px`,
              '--dy': `${c.dy}px`,
            } as CSSProperties
          }
        >
          <AsciiCoin size="sm" spinning />
        </div>
      ))}
    </div>
  );
}
