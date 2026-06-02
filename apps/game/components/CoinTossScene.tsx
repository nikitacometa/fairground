'use client';

/**
 * CoinTossScene — the signature pending animation: a coin is tossed into the air,
 * tumbles, falls, bounces and wobbles to a brief rest, then is tossed again. A small
 * physics model (projectile + angular spin + damped landing wobble) drives a donut.c-style
 * ASCII renderer with a ground shadow that shrinks with height. No dependencies, no WebGL.
 *
 * Ten hardcoded VARIANTS give visibly different tosses (arc, spin, corkscrew, drift,
 * wobble, light, ramp). A session picks one deterministically so the same flip always
 * replays the same toss, but different sessions feel fresh.
 *
 * Only the <pre> textContent is mutated per frame (via refs); React never re-renders.
 */

import { useEffect, useRef } from 'react';

// Coin geometry (unit radius).
const R = 1;
const T = 0.13; // half-thickness
const DOME = 0.55; // face convexity

interface Variant {
  ramp: string;
  v0: number; // launch velocity (sets arc height)
  gravity: number;
  spin: number; // tumble speed (rad per unit dt) about the flip axis
  corkscrew: number; // extra spin about the vertical axis (0 = clean flip)
  baseTilt: number; // constant Y tilt for a 3D read
  drift: number; // horizontal sway amplitude (chars)
  driftFreq: number;
  wobbleImpulse: number; // landing rock magnitude
  wobbleStiff: number;
  wobbleDamp: number;
  bounceDamp: number; // fraction of velocity kept per bounce
  restFrames: number; // frames to rest flat before re-tossing
  light: readonly [number, number, number];
}

const norm3 = (v: readonly [number, number, number]): [number, number, number] => {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};

// Ten distinct tosses. Tuned to feel different: lazy/high, tight/fast, corkscrew, low/quick,
// drifting, double-bounce, edge-heavy, slow/majestic, chaotic, gentle float.
const VARIANTS: Variant[] = [
  {
    ramp: ' .,-~:;=!*#$@',
    v0: 1.05,
    gravity: 0.045,
    spin: 0.16,
    corkscrew: 0.0,
    baseTilt: 0.42,
    drift: 0.0,
    driftFreq: 0,
    wobbleImpulse: 0.5,
    wobbleStiff: 0.05,
    wobbleDamp: 0.9,
    bounceDamp: 0.5,
    restFrames: 18,
    light: norm3([0, 0.62, -0.78]),
  },
  {
    ramp: ' .:-=+*#%@█',
    v0: 0.78,
    gravity: 0.05,
    spin: 0.32,
    corkscrew: 0.0,
    baseTilt: 0.3,
    drift: 0.0,
    driftFreq: 0,
    wobbleImpulse: 0.35,
    wobbleStiff: 0.08,
    wobbleDamp: 0.86,
    bounceDamp: 0.42,
    restFrames: 12,
    light: norm3([0.2, 0.6, -0.77]),
  },
  {
    ramp: ' .,-~:;=!*#$@',
    v0: 0.92,
    gravity: 0.046,
    spin: 0.18,
    corkscrew: 0.12,
    baseTilt: 0.5,
    drift: 0.0,
    driftFreq: 0,
    wobbleImpulse: 0.4,
    wobbleStiff: 0.06,
    wobbleDamp: 0.88,
    bounceDamp: 0.48,
    restFrames: 14,
    light: norm3([-0.2, 0.65, -0.73]),
  },
  {
    ramp: ' .:-=+*#%@',
    v0: 0.62,
    gravity: 0.058,
    spin: 0.27,
    corkscrew: 0.0,
    baseTilt: 0.36,
    drift: 0.0,
    driftFreq: 0,
    wobbleImpulse: 0.3,
    wobbleStiff: 0.09,
    wobbleDamp: 0.85,
    bounceDamp: 0.35,
    restFrames: 10,
    light: norm3([0, 0.55, -0.83]),
  },
  {
    ramp: ' .,-~:;=!*#$@',
    v0: 0.95,
    gravity: 0.046,
    spin: 0.2,
    corkscrew: 0.05,
    baseTilt: 0.44,
    drift: 3.2,
    driftFreq: 0.9,
    wobbleImpulse: 0.45,
    wobbleStiff: 0.05,
    wobbleDamp: 0.9,
    bounceDamp: 0.5,
    restFrames: 14,
    light: norm3([0.35, 0.6, -0.72]),
  },
  {
    ramp: ' .:-=+*#%@█',
    v0: 1.0,
    gravity: 0.05,
    spin: 0.24,
    corkscrew: 0.0,
    baseTilt: 0.4,
    drift: 0.0,
    driftFreq: 0,
    wobbleImpulse: 0.55,
    wobbleStiff: 0.045,
    wobbleDamp: 0.93,
    bounceDamp: 0.6,
    restFrames: 16,
    light: norm3([0, 0.7, -0.71]),
  },
  {
    ramp: ' .,-~:;=!*#$@',
    v0: 0.85,
    gravity: 0.048,
    spin: 0.12,
    corkscrew: 0.0,
    baseTilt: 0.62,
    drift: 0.0,
    driftFreq: 0,
    wobbleImpulse: 0.6,
    wobbleStiff: 0.05,
    wobbleDamp: 0.9,
    bounceDamp: 0.5,
    restFrames: 16,
    light: norm3([-0.3, 0.58, -0.76]),
  },
  {
    ramp: ' .`:-=+*o#%@',
    v0: 1.15,
    gravity: 0.04,
    spin: 0.1,
    corkscrew: 0.0,
    baseTilt: 0.46,
    drift: 0.0,
    driftFreq: 0,
    wobbleImpulse: 0.5,
    wobbleStiff: 0.04,
    wobbleDamp: 0.92,
    bounceDamp: 0.55,
    restFrames: 20,
    light: norm3([0.1, 0.66, -0.74]),
  },
  {
    ramp: ' .:-=+*#%@',
    v0: 0.7,
    gravity: 0.052,
    spin: 0.3,
    corkscrew: 0.18,
    baseTilt: 0.34,
    drift: 1.6,
    driftFreq: 1.4,
    wobbleImpulse: 0.5,
    wobbleStiff: 0.07,
    wobbleDamp: 0.82,
    bounceDamp: 0.45,
    restFrames: 10,
    light: norm3([0.25, 0.62, -0.74]),
  },
  {
    ramp: ' .,-~:;=!*#$@',
    v0: 0.72,
    gravity: 0.042,
    spin: 0.14,
    corkscrew: 0.03,
    baseTilt: 0.5,
    drift: 2.2,
    driftFreq: 0.6,
    wobbleImpulse: 0.35,
    wobbleStiff: 0.05,
    wobbleDamp: 0.9,
    bounceDamp: 0.4,
    restFrames: 12,
    light: norm3([0, 0.6, -0.8]),
  },
];

interface GridSpec {
  w: number;
  h: number;
  k1x: number;
  k1y: number;
  k2: number;
  groundRow: number; // rest position of the coin centre (char rows from top)
  heightScale: number; // chars of vertical travel per unit yPos
}

function renderToss(
  angleX: number,
  tiltY: number,
  rockZ: number,
  yPos: number,
  xPos: number,
  grid: GridSpec,
  v: Variant,
): string {
  const { w, h, k1x, k1y, k2, groundRow, heightScale } = grid;
  const size = w * h;
  const out = new Array<string>(size).fill(' ');
  const zbuf = new Float32Array(size).fill(-Infinity);
  const ramp = v.ramp;
  const L = v.light;

  const sinA = Math.sin(angleX);
  const cosA = Math.cos(angleX);
  const sinB = Math.sin(tiltY);
  const cosB = Math.cos(tiltY);
  const sinC = Math.sin(rockZ);
  const cosC = Math.cos(rockZ);

  const centerRow = groundRow - yPos * heightScale;
  const centerCol = w / 2 + xPos;

  const plot = (px: number, py: number, pz: number, nx: number, ny: number, nz: number): void => {
    // Rotate about X (flip).
    const y1 = py * cosA - pz * sinA;
    const z1 = py * sinA + pz * cosA;
    const x1 = px;
    const ny1 = ny * cosA - nz * sinA;
    const nz1 = ny * sinA + nz * cosA;
    const nx1 = nx;
    // Rotate about Z (landing wobble / rock).
    const x2 = x1 * cosC - y1 * sinC;
    const y2 = x1 * sinC + y1 * cosC;
    const z2 = z1;
    const nx2 = nx1 * cosC - ny1 * sinC;
    const ny2 = nx1 * sinC + ny1 * cosC;
    const nz2 = nz1;
    // Rotate about Y (depth tilt + corkscrew).
    const x3 = x2 * cosB + z2 * sinB;
    const z3 = -x2 * sinB + z2 * cosB;
    const y3 = y2;
    const nx3 = nx2 * cosB + nz2 * sinB;
    const nz3 = -nx2 * sinB + nz2 * cosB;
    const ny3 = ny2;

    const ooz = 1 / (z3 + k2);
    const xp = Math.round(centerCol + k1x * ooz * x3);
    const yp = Math.round(centerRow - k1y * ooz * y3);
    if (xp < 0 || xp >= w || yp < 0 || yp >= h) return;
    const idx = yp * w + xp;
    if (ooz <= zbuf[idx]!) return;
    const lum = nx3 * L[0] + ny3 * L[1] + nz3 * L[2];
    let ci = Math.floor(((lum + 1) / 2) * (ramp.length - 1));
    if (ci < 0) ci = 0;
    if (ci >= ramp.length) ci = ramp.length - 1;
    zbuf[idx] = ooz;
    out[idx] = ramp[ci]!;
  };

  // Ground shadow — an ellipse at groundRow that shrinks/fades as the coin rises.
  const lift = Math.max(0, Math.min(1, yPos / 9));
  const shW = Math.max(2, Math.round((10 - lift * 7) * 1.0));
  const shadowChars = lift > 0.66 ? '.' : lift > 0.33 ? ':' : '-';
  const groundY = grid.groundRow + 5;
  if (groundY >= 0 && groundY < h) {
    const cx = Math.round(w / 2 + xPos * 0.6);
    for (let dx = -shW; dx <= shW; dx++) {
      const xp = cx + dx;
      if (xp < 0 || xp >= w) continue;
      // elliptical falloff
      if (Math.abs(dx) > shW - 1 && lift > 0.2) continue;
      const idx = groundY * w + xp;
      if (out[idx] === ' ') out[idx] = shadowChars;
    }
  }

  // Faces (domed) + rim.
  for (let r = 0.06; r <= R; r += 0.035) {
    const tn = (r / R) * DOME;
    const nm = Math.hypot(tn, 1);
    for (let th = 0; th < Math.PI * 2; th += 0.05) {
      const c = Math.cos(th);
      const s = Math.sin(th);
      plot(r * c, r * s, T, (tn * c) / nm, (tn * s) / nm, 1 / nm);
      plot(r * c, r * s, -T, (tn * c) / nm, (tn * s) / nm, -1 / nm);
    }
  }
  for (let th = 0; th < Math.PI * 2; th += 0.045) {
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let zz = -T; zz <= T; zz += 0.035) {
      plot(R * c, R * s, zz, c, s, 0);
    }
  }

  let str = '';
  for (let y = 0; y < h; y++) str += out.slice(y * w, y * w + w).join('') + '\n';
  return str;
}

export interface CoinTossSceneProps {
  /** Variation index 0-9 (a session picks one). */
  variant?: number;
  className?: string;
}

export function CoinTossScene({ variant = 0, className }: CoinTossSceneProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const v = VARIANTS[((variant % VARIANTS.length) + VARIANTS.length) % VARIANTS.length]!;

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;

    const grid: GridSpec = {
      w: 44,
      h: 38,
      k2: 5,
      k1y: 34,
      k1x: 68,
      groundRow: 26,
      heightScale: 1.0,
    };

    // Physics state.
    let angleX = 0;
    let tiltY = v.baseTilt;
    let rockZ = 0;
    let rockVel = 0;
    let yPos = 0;
    let vy = v.v0;
    let driftT = 0;
    let restCount = 0;
    let resting = false;

    let last = 0;
    let raf = 0;
    const step = (ts: number): void => {
      const dt = last ? Math.min((ts - last) / 16.67, 2.5) : 1;
      last = ts;

      // Spin always tumbles; corkscrew adds a slow Y rotation.
      angleX += v.spin * dt;
      tiltY = v.baseTilt + (v.corkscrew ? v.corkscrew * (ts / 1000) : 0);

      if (resting) {
        restCount -= dt;
        // damp the rock to flat, then re-toss
        rockVel += -rockZ * v.wobbleStiff * dt;
        rockVel *= v.wobbleDamp;
        rockZ += rockVel * dt;
        if (restCount <= 0) {
          resting = false;
          vy = v.v0 * (0.92 + 0.16 * ((Math.sin(ts) + 1) / 2 || 0)); // tiny per-toss variety
          driftT = 0;
        }
      } else {
        vy -= v.gravity * dt;
        yPos += vy * dt;
        if (v.drift) {
          driftT += dt;
        }
        if (yPos <= 0) {
          yPos = 0;
          if (Math.abs(vy) > 0.18) {
            vy = -vy * v.bounceDamp; // bounce
            rockVel += (vy > 0 ? 1 : -1) * v.wobbleImpulse * 0.5;
          } else {
            // settle: rock + rest
            vy = 0;
            rockVel += v.wobbleImpulse;
            resting = true;
            restCount = v.restFrames;
          }
        }
        // wobble decays while airborne too (subtle)
        rockVel += -rockZ * v.wobbleStiff * 0.5 * dt;
        rockVel *= 0.97;
        rockZ += rockVel * dt;
      }

      const xPos = v.drift ? v.drift * Math.sin(driftT * v.driftFreq) : 0;
      el.textContent = renderToss(angleX, tiltY, rockZ, yPos, xPos, grid, v);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v]);

  return (
    <pre
      ref={preRef}
      aria-hidden
      className={className}
      style={{
        color: 'var(--color-primary)',
        lineHeight: '1em',
        fontSize: '0.62rem',
        letterSpacing: '0.06em',
        margin: 0,
        textShadow: '0 0 8px var(--color-primary)',
        fontFamily: 'var(--font-mono)',
        userSelect: 'none',
      }}
    />
  );
}
