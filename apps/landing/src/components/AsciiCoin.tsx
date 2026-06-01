/**
 * AsciiCoin — a 3D coin rendered as tumbling ASCII, the signature visual of Fairground.
 *
 * Technique: the "donut.c" rotating-ASCII approach adapted to a thin cylinder (a coin).
 * Each frame we sample points on the two circular faces and the rim, rotate them about
 * the X axis (the tumble) and a small fixed Y tilt (for depth), perspective-project to a
 * character grid, shade by surface-normal · light into an ASCII luminance ramp, and keep
 * the nearest point per cell via a z-buffer. No dependencies, no WebGL — just text.
 *
 * Animation states:
 *   - spinning: continuous fast tumble.
 *   - result set: ease the tumble to a stop landing flat on a face (win = front face,
 *     loss = back face) and tint the glyphs by outcome.
 *
 * Only the <pre> textContent and color are mutated per frame (via refs), so the React
 * tree never re-renders during animation.
 */

import { useEffect, useRef } from 'react';

const RAMP = ' .,-~:;=!*#$@'; // luminance ramp, index 0 = unlit (space)

// Coin geometry (unit radius).
const R = 1;
const T = 0.13; // half-thickness
const Y_TILT = 0.42; // constant Y rotation so a face-on coin still shows a gradient

// Light direction (from top-front), normalised.
const L = (() => {
  const v = [0.0, 0.62, -0.78];
  const m = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / m, v[1]! / m, v[2]! / m] as const;
})();

interface GridSpec {
  w: number;
  h: number;
  k1x: number;
  k1y: number;
  k2: number;
}

const SIZES: Record<'sm' | 'lg', GridSpec> = {
  sm: { w: 30, h: 16, k2: 5, k1y: 32, k1x: 64 },
  lg: { w: 46, h: 24, k2: 5, k1y: 48, k1x: 96 },
};

function renderFrame(angleX: number, grid: GridSpec): string {
  const { w, h, k1x, k1y, k2 } = grid;
  const size = w * h;
  const out = new Array<string>(size).fill(' ');
  const zbuf = new Float32Array(size).fill(-Infinity);

  const sinA = Math.sin(angleX);
  const cosA = Math.cos(angleX);
  const sinB = Math.sin(Y_TILT);
  const cosB = Math.cos(Y_TILT);

  const plot = (px: number, py: number, pz: number, nx: number, ny: number, nz: number): void => {
    // Rotate about X (the tumble).
    const y1 = py * cosA - pz * sinA;
    const z1 = py * sinA + pz * cosA;
    const x1 = px;
    const ny1 = ny * cosA - nz * sinA;
    const nz1 = ny * sinA + nz * cosA;
    const nx1 = nx;
    // Rotate about Y (fixed tilt for depth).
    const x2 = x1 * cosB + z1 * sinB;
    const z2 = -x1 * sinB + z1 * cosB;
    const y2 = y1;
    const nx2 = nx1 * cosB + nz1 * sinB;
    const nz2 = -nx1 * sinB + nz1 * cosB;
    const ny2 = ny1;

    const ooz = 1 / (z2 + k2);
    const xp = Math.round(w / 2 + k1x * ooz * x2);
    const yp = Math.round(h / 2 - k1y * ooz * y2);
    if (xp < 0 || xp >= w || yp < 0 || yp >= h) return;
    const idx = yp * w + xp;
    if (ooz <= zbuf[idx]!) return;

    const lum = nx2 * L[0] + ny2 * L[1] + nz2 * L[2];
    // Map [-1,1] -> ramp, with the lit side bright and the back side fading to space.
    let ci = Math.floor(((lum + 1) / 2) * (RAMP.length - 1));
    if (ci < 0) ci = 0;
    if (ci >= RAMP.length) ci = RAMP.length - 1;
    zbuf[idx] = ooz;
    out[idx] = RAMP[ci]!;
  };

  // Faces (top z=+T, bottom z=-T). The face normal is domed outward with radius so the
  // coin reads as a convex struck disc (a light gradient across the face) rather than a
  // flat uniform plate. dome=0 at the center, tilting outward toward the rim.
  const DOME = 0.55;
  for (let r = 0.06; r <= R; r += 0.03) {
    const t = (r / R) * DOME;
    const nm = Math.hypot(t, 1);
    for (let th = 0; th < Math.PI * 2; th += 0.045) {
      const c = Math.cos(th);
      const s = Math.sin(th);
      plot(r * c, r * s, T, (t * c) / nm, (t * s) / nm, 1 / nm);
      plot(r * c, r * s, -T, (t * c) / nm, (t * s) / nm, -1 / nm);
    }
  }
  // Rim.
  for (let th = 0; th < Math.PI * 2; th += 0.04) {
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let zz = -T; zz <= T; zz += 0.03) {
      plot(R * c, R * s, zz, c, s, 0);
    }
  }

  let str = '';
  for (let y = 0; y < h; y++) {
    str += out.slice(y * w, y * w + w).join('') + '\n';
  }
  return str;
}

export interface AsciiCoinProps {
  size?: 'sm' | 'lg';
  /** Continuous fast tumble. */
  spinning?: boolean;
  /** When set, the coin eases to a stop on a face and tints by outcome. */
  result?: 'win' | 'loss' | null;
  className?: string;
}

export function AsciiCoin({
  size = 'lg',
  spinning = true,
  result = null,
  className,
}: AsciiCoinProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const angleRef = useRef(0);
  const velRef = useRef(0.22);
  const rafRef = useRef<number | null>(null);
  // Track the resolve target so deceleration is computed once.
  const targetRef = useRef<number | null>(null);

  const grid = SIZES[size];

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;

    let last = 0;
    const step = (ts: number): void => {
      const dt = last ? Math.min((ts - last) / 16.67, 3) : 1;
      last = ts;

      if (result && targetRef.current === null) {
        // Land flat: win = front face (2πk), loss = back face (π + 2πk). Add a couple of
        // extra spins so the stop feels earned, then ease in over the remaining distance.
        const a = angleRef.current;
        const base = result === 'win' ? 0 : Math.PI;
        let target = Math.ceil((a - base) / (Math.PI * 2)) * (Math.PI * 2) + base;
        target += Math.PI * 2 * 2;
        targetRef.current = target;
      }

      if (targetRef.current !== null) {
        // Ease toward the landing angle.
        const remaining = targetRef.current - angleRef.current;
        if (remaining > 0.0015) {
          angleRef.current += Math.max(remaining * 0.08, 0.004) * dt;
        } else {
          angleRef.current = targetRef.current;
        }
      } else {
        angleRef.current += velRef.current * dt;
      }

      el.textContent = renderFrame(angleRef.current, grid);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [grid, result]);

  // Reset the landing target if we go back to spinning (e.g. play again).
  useEffect(() => {
    if (spinning && !result) {
      targetRef.current = null;
      velRef.current = 0.22;
    }
  }, [spinning, result]);

  const color =
    result === 'win'
      ? 'var(--color-win)'
      : result === 'loss'
        ? 'var(--color-lose)'
        : 'var(--color-primary)';

  return (
    <pre
      ref={preRef}
      aria-hidden
      className={className}
      style={{
        color,
        lineHeight: '1em',
        fontSize: size === 'lg' ? '0.7rem' : '0.6rem',
        letterSpacing: '0.06em',
        margin: 0,
        textShadow: `0 0 8px ${color}`,
        transition: 'color 0.5s ease, text-shadow 0.5s ease',
        fontFamily: 'var(--font-mono)',
        userSelect: 'none',
      }}
    />
  );
}
