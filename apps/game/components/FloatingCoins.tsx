'use client';

/**
 * FloatingCoins — a depth-tiered field of ASCII coins drifting slowly behind the game,
 * so the screen around the panel feels alive instead of empty. Near/mid/ghost tiers with
 * per-coin scale + opacity; blur scales inversely with size for depth. Gated for weak
 * devices and disabled under reduced-motion.
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

const COINS: Drifter[] = [
  { left: '8%', top: '20%', scale: 0.8, op: 0.16, dur: 46, delay: 0, dx: 46, dy: -34 },
  { left: '78%', top: '26%', scale: 0.72, op: 0.14, dur: 54, delay: -12, dx: -42, dy: 38 },
  { left: '6%', top: '70%', scale: 0.6, op: 0.12, dur: 58, delay: -30, dx: 44, dy: -48 },
  { left: '80%', top: '72%', scale: 0.85, op: 0.15, dur: 50, delay: -26, dx: -40, dy: -36 },
  { left: '30%', top: '86%', scale: 0.5, op: 0.1, dur: 62, delay: -8, dx: 50, dy: 40 },
  { left: '66%', top: '10%', scale: 0.34, op: 0.06, dur: 70, delay: -18, dx: -32, dy: 36 },
  { left: '20%', top: '44%', scale: 0.3, op: 0.05, dur: 64, delay: -40, dx: 30, dy: -30 },
];

export default function FloatingCoins() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const weak = window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 4) < 4;
    setCount(weak ? 3 : COINS.length);
  }, []);

  if (count === 0) return null;

  return (
    <div aria-hidden className="bg-layer">
      <div className="floating-coins">
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
    </div>
  );
}
