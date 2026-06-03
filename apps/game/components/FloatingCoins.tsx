'use client';

/**
 * FloatingCoins — a depth-tiered field of ASCII coins that physically drift across the
 * screen and bounce off the edges (old-screensaver style), so the space around the panel
 * feels alive. A single rAF loop integrates position/velocity per coin and writes the
 * transform directly; each coin still spins via its own AsciiCoin renderer. Near coins are
 * larger/faster/sharper, ghost coins small/slow/blurred. Wall bounces pop the brightness.
 * Gated for weak devices, disabled under reduced-motion.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AsciiCoin } from './AsciiCoin';

interface Drifter {
  scale: number;
  op: number;
  spd: number;
}

const COINS: Drifter[] = [
  { scale: 0.8, op: 0.16, spd: 28 },
  { scale: 0.72, op: 0.14, spd: 25 },
  { scale: 0.6, op: 0.12, spd: 20 },
  { scale: 0.85, op: 0.15, spd: 23 },
  { scale: 0.5, op: 0.1, spd: 18 },
  { scale: 0.34, op: 0.06, spd: 13 },
  { scale: 0.3, op: 0.05, spd: 12 },
];

export default function FloatingCoins() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const weak = window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 4) < 4;
    setCount(weak ? 3 : COINS.length);
  }, []);

  useEffect(() => {
    const container = ref.current;
    if (!container || count === 0) return;
    const els = Array.from(container.querySelectorAll<HTMLElement>('.floating-coin'));

    const state = els.map((el, i) => {
      const cfg = COINS[i]!;
      const w = el.offsetWidth || 200 * cfg.scale;
      const h = el.offsetHeight || 100 * cfg.scale;
      const a = Math.random() * Math.PI * 2;
      return {
        el,
        w,
        h,
        x: Math.random() * Math.max(1, window.innerWidth - w),
        y: Math.random() * Math.max(1, window.innerHeight - h),
        vx: Math.cos(a) * cfg.spd,
        vy: Math.sin(a) * cfg.spd,
        scale: cfg.scale,
        op: cfg.op,
        flash: 0,
      };
    });

    let raf = 0;
    let last = 0;
    const step = (ts: number): void => {
      const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016;
      last = ts;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      for (const s of state) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        let bounced = false;
        if (s.x <= 0) {
          s.x = 0;
          s.vx = Math.abs(s.vx);
          bounced = true;
        } else if (s.x + s.w >= vw) {
          s.x = vw - s.w;
          s.vx = -Math.abs(s.vx);
          bounced = true;
        }
        if (s.y <= 0) {
          s.y = 0;
          s.vy = Math.abs(s.vy);
          bounced = true;
        } else if (s.y + s.h >= vh) {
          s.y = vh - s.h;
          s.vy = -Math.abs(s.vy);
          bounced = true;
        }
        if (bounced) {
          s.flash = 1;
          const j = 1 + (Math.random() - 0.5) * 0.18;
          s.vx *= j;
          s.vy *= 2 - j;
        }
        if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.6);
        s.el.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
        s.el.style.opacity = `${s.op * (1 + s.flash * 1.6)}`;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  if (count === 0) return null;

  return (
    <div aria-hidden className="bg-layer">
      <div ref={ref} className="floating-coins">
        {COINS.slice(0, count).map((c, i) => (
          <div
            key={i}
            className="floating-coin"
            style={{ '--scale': `${c.scale}`, opacity: c.op } as CSSProperties}
          >
            <AsciiCoin size="sm" spinning />
          </div>
        ))}
      </div>
    </div>
  );
}
