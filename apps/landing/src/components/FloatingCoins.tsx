/**
 * FloatingCoins — a depth-tiered field of ASCII coins that physically drift across the
 * viewport and bounce off the edges (old-screensaver style), giving the dark canvas life
 * without standing still. A single rAF loop integrates position/velocity for every coin
 * and writes the transform directly (no React re-renders); each coin still spins via its
 * own AsciiCoin renderer. Near-tier coins are larger/faster/sharper, ghost-tier are small/
 * slow/blurred for parallax depth. Each wall bounce pops the brightness briefly.
 *
 * Gated: fewer on small/weak devices, none under prefers-reduced-motion. Mounted once in
 * BaseLayout (client:idle), behind all content.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AsciiCoin } from './AsciiCoin';

interface Drifter {
  scale: number;
  op: number;
  spd: number; // base drift speed, px/s — fastest tier is ~3x the slowest
  spin: number; // per-coin tumble speed (rad/frame) handed to AsciiCoin
}

// Ordered most-visible first so the mobile slice keeps the best ones.
const COINS: Drifter[] = [
  { scale: 0.85, op: 0.18, spd: 34, spin: 0.18 }, // near — big, fast, quick tumble
  { scale: 0.78, op: 0.16, spd: 30, spin: 0.16 },
  { scale: 0.9, op: 0.17, spd: 26, spin: 0.14 },
  { scale: 0.55, op: 0.11, spd: 18, spin: 0.1 }, // mid
  { scale: 0.5, op: 0.1, spd: 15, spin: 0.09 },
  { scale: 0.6, op: 0.12, spd: 20, spin: 0.11 },
  { scale: 0.32, op: 0.05, spd: 12, spin: 0.06 }, // ghost — small, slow, lazy tumble
  { scale: 0.3, op: 0.05, spd: 11, spin: 0.05 },
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
      // Bias travel to a near-diagonal: pick a quadrant diagonal (45/135/225/315°) and
      // jitter ±22.5°, so coins glide across corners rather than straight along an axis.
      // Per-coin speed jitter on top of the tier base so no two drift at the same rate.
      const speed = cfg.spd * (0.85 + Math.random() * 0.5);
      const a =
        Math.PI / 4 +
        Math.floor(Math.random() * 4) * (Math.PI / 2) +
        (Math.random() - 0.5) * (Math.PI / 4);
      return {
        el,
        w,
        h,
        x: Math.random() * Math.max(1, window.innerWidth - w),
        y: Math.random() * Math.max(1, window.innerHeight - h),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
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
          // nudge the trajectory so it never settles into a fixed loop
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
    <div ref={ref} aria-hidden className="floating-coins">
      {COINS.slice(0, count).map((c, i) => (
        <div
          key={i}
          className="floating-coin"
          style={{ '--scale': `${c.scale}`, opacity: c.op } as CSSProperties}
        >
          <AsciiCoin size="sm" spinning spinSpeed={c.spin} />
        </div>
      ))}
    </div>
  );
}
