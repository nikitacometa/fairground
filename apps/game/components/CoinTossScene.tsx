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

// Pre-allocated render buffers (module-level — no per-frame allocation, no GC churn).
const MAX_CELLS = 60 * 46;
const _out = new Array<string>(MAX_CELLS).fill(' ');
const _zbuf = new Float32Array(MAX_CELLS);
const TWO_PI = Math.PI * 2;
const BEVEL = 0.06; // rounded outer-edge radius (the volume cue)
const REED_GROOVES = 30; // milled ridges around the rim

// mulberry32 — tiny deterministic PRNG for seeded per-toss variation.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// renderToss — rasterizes one frame of the coin into the shared char buffer. The coin is a
// beveled, reeded, domed disc lit by a moving light (diffuse + a tight specular hotspot),
// with a crisp silhouette pass for a solid 3D read. `light` is the per-frame light vector
// (it orbits over time, so the same coin angle never shades identically).
function renderToss(
  angleX: number,
  tiltY: number,
  rockZ: number,
  yPos: number,
  xPos: number,
  grid: GridSpec,
  v: Variant,
  light: readonly [number, number, number],
): string {
  const { w, h, k1x, k1y, k2, groundRow, heightScale } = grid;
  const cells = w * h;
  const out = _out;
  const zbuf = _zbuf;
  out.fill(' ', 0, cells);
  zbuf.fill(-Infinity, 0, cells);
  const ramp = v.ramp;
  const rampMax = ramp.length - 1;
  const Lx = light[0];
  const Ly = light[1];
  const Lz = light[2];
  // Specular light = the diffuse light biased frontal/up, for a tight moving hotspot.
  let Sx = Lx * 0.4;
  let Sy = Ly * 0.55 + 0.45;
  let Sz = Lz - 0.25;
  const sm = Math.hypot(Sx, Sy, Sz) || 1;
  Sx /= sm;
  Sy /= sm;
  Sz /= sm;

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
    const diff = nx3 * Lx + ny3 * Ly + nz3 * Lz;
    const sd = nx3 * Sx + ny3 * Sy + nz3 * Sz;
    const spec = sd > 0 ? sd * sd * sd * sd * sd * sd * 0.55 : 0; // pow(sd,6)
    let ci = Math.floor(((diff + spec + 1) / 2) * rampMax);
    if (ci < 0) ci = 0;
    if (ci > rampMax) ci = rampMax;
    zbuf[idx] = ooz;
    out[idx] = ramp[ci]!;
  };

  // --- Coin geometry ---
  // Faces (domed convex disc) with a struck ring groove that catches the moving light.
  const faceR = R - BEVEL;
  for (let r = 0.05; r <= faceR; r += 0.024) {
    let tn = (r / R) * DOME;
    // Ring groove relief near r=0.62: tilt the face normal in/out along its walls.
    const d = r - 0.62;
    if (d > -0.06 && d < 0.06) tn += -Math.sign(d) * (0.06 - Math.abs(d)) * 5;
    const nm = Math.hypot(tn, 1);
    for (let th = 0; th < TWO_PI; th += 0.03) {
      const c = Math.cos(th);
      const s = Math.sin(th);
      plot(r * c, r * s, T, (tn * c) / nm, (tn * s) / nm, 1 / nm);
      plot(r * c, r * s, -T, (tn * c) / nm, (tn * s) / nm, -1 / nm);
    }
  }
  // Bevel — rounded quarter-circle from face edge to rim, top and bottom. The bright
  // crescent it produces is what makes the coin read as a solid struck disc.
  for (let a = 0; a <= Math.PI / 2 + 1e-6; a += 0.16) {
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const pr = faceR + BEVEL * sa;
    const pz = T - BEVEL + BEVEL * ca;
    for (let th = 0; th < TWO_PI; th += 0.04) {
      const c = Math.cos(th);
      const s = Math.sin(th);
      plot(pr * c, pr * s, pz, sa * c, sa * s, ca);
      plot(pr * c, pr * s, -pz, sa * c, sa * s, -ca);
    }
  }
  // Reeded rim — radius modulated into milled ridges around the edge.
  const gStep = TWO_PI / REED_GROOVES;
  const rimZ = T - BEVEL * 0.5;
  for (let th = 0; th < TWO_PI; th += 0.032) {
    const c = Math.cos(th);
    const s = Math.sin(th);
    const groove = 0.5 - 0.5 * Math.cos(((th % gStep) / gStep) * TWO_PI);
    const reff = R - 0.03 * groove;
    for (let zz = -rimZ; zz <= rimZ; zz += 0.03) {
      plot(reff * c, reff * s, zz, c, s, 0);
    }
  }

  // --- Edge-outline pass: force the brightest glyph on the silhouette (vs empty space). ---
  const oc = ramp[rampMax]!;
  for (let row = 1; row < h - 1; row++) {
    const base = row * w;
    for (let col = 1; col < w - 1; col++) {
      const idx = base + col;
      if (
        out[idx] !== ' ' &&
        (out[idx - 1] === ' ' ||
          out[idx + 1] === ' ' ||
          out[idx - w] === ' ' ||
          out[idx + w] === ' ')
      ) {
        out[idx] = oc;
      }
    }
  }

  // --- Ground shadow (after the outline so it is never outlined). ---
  const lift = Math.max(0, Math.min(1, yPos / 9));
  const shW = Math.max(2, Math.round(10 - lift * 7));
  const shadowChars = lift > 0.66 ? '.' : lift > 0.33 ? ':' : '-';
  const groundY = groundRow + 5;
  if (groundY >= 0 && groundY < h) {
    const cx = Math.round(w / 2 + xPos * 0.6);
    for (let dx = -shW; dx <= shW; dx++) {
      const xp = cx + dx;
      if (xp < 0 || xp >= w) continue;
      if (Math.abs(dx) > shW - 1 && lift > 0.2) continue;
      const idx = groundY * w + xp;
      if (out[idx] === ' ') out[idx] = shadowChars;
    }
  }

  let str = '';
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let rowStr = '';
    for (let x = 0; x < w; x++) rowStr += out[base + x];
    str += rowStr + '\n';
  }
  return str;
}

export interface CoinTossSceneProps {
  /** Variation index 0-9 (a session picks one). */
  variant?: number;
  /** md = in-game panel, lg = cinematic landing hero. */
  size?: 'md' | 'lg';
  className?: string;
}

const GRIDS: Record<'md' | 'lg', GridSpec> = {
  // md = in-game pending panel (bigger + denser than before for a more voluminous read).
  md: { w: 50, h: 42, k2: 5, k1y: 38, k1x: 76, groundRow: 29, heightScale: 1.0 },
  // lg = cinematic landing hero (sized to fit the tuned hero layout).
  lg: { w: 60, h: 46, k2: 5, k1y: 42, k1x: 84, groundRow: 32, heightScale: 1.0 },
};

// Per-toss physics + lighting, re-seeded each cycle from (variant, tossIdx). No two tosses
// repeat — the fix for the old 3-4s loop that played ~7x through the ~20-28s VRF wait.
interface TossParams {
  v0: number;
  spin: number;
  drift: number;
  driftFreq: number;
  corkscrew: number;
  lightAz0: number;
  restScale: number;
}
function tossParams(variant: number, idx: number, v: Variant): TossParams {
  const rng = mulberry32((((variant + 1) * 2654435761) ^ (idx * 40503)) >>> 0);
  return {
    v0: v.v0 * (0.85 + rng() * 0.4),
    spin: v.spin * (0.7 + rng() * 0.7),
    drift: (v.drift || 1.6) * (0.3 + rng() * 1.3) * (rng() > 0.5 ? 1 : -1),
    driftFreq: v.driftFreq || 0.6 + rng() * 0.9,
    corkscrew: (rng() - 0.5) * 0.45,
    lightAz0: rng() * TWO_PI,
    restScale: 0.8 + rng() * 1.6,
  };
}

export function CoinTossScene({ variant = 0, size = 'md', className }: CoinTossSceneProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const v = VARIANTS[((variant % VARIANTS.length) + VARIANTS.length) % VARIANTS.length]!;

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;

    // Hardware gate: the larger lg grid only on capable devices; weak/mobile uses md.
    const allowLg =
      typeof window !== 'undefined' &&
      (navigator.hardwareConcurrency ?? 4) >= 4 &&
      window.innerWidth >= 640;
    const grid: GridSpec = size === 'lg' && allowLg ? GRIDS.lg : GRIDS.md;

    // Reduced motion: one static resting frame, no animation loop.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      const lm = Math.hypot(0, 0.6, -0.8);
      el.textContent = renderToss(0.5, v.baseTilt, 0, 0, 0, grid, v, [0, 0.6 / lm, -0.8 / lm]);
      return;
    }

    // Physics state.
    let tossIdx = 0;
    let p = tossParams(variant, tossIdx, v);
    let angleX = 0;
    let tiltY = v.baseTilt;
    let rockZ = 0;
    let rockVel = 0;
    let yPos = 0;
    let vy = p.v0;
    let driftT = 0;
    let restCount = 0;
    let resting = false;

    let last = 0;
    let raf = 0;
    const step = (ts: number): void => {
      const dt = last ? Math.min((ts - last) / 16.67, 2.5) : 1;
      last = ts;

      // Orbiting light: azimuth drifts with absolute time (+ a per-toss offset). This is what
      // keeps the same coin angle from ever shading identically across the long VRF wait.
      const az = p.lightAz0 + ts * 0.00035;
      let lx = Math.sin(az) * 0.55;
      let ly = 0.5 + 0.18 * Math.sin(ts * 0.0006);
      let lz = -Math.cos(az) * 0.62;
      const lm = Math.hypot(lx, ly, lz) || 1;
      lx /= lm;
      ly /= lm;
      lz /= lm;

      // Spin slows near the apex (coupled to |vy|) — a "held breath" before the fall.
      const spinMult = 0.3 + 0.7 * Math.min(1, Math.abs(vy) / Math.max(0.001, p.v0));
      angleX += p.spin * spinMult * dt;
      tiltY = v.baseTilt + p.corkscrew * (ts / 1000);

      if (resting) {
        restCount -= dt;
        rockVel += -rockZ * v.wobbleStiff * dt;
        rockVel *= v.wobbleDamp;
        rockZ += rockVel * dt;
        if (restCount <= 0) {
          // Re-toss with fresh seeded parameters — the cycle never repeats identically.
          resting = false;
          tossIdx += 1;
          p = tossParams(variant, tossIdx, v);
          vy = p.v0;
          driftT = 0;
        }
      } else {
        vy -= v.gravity * dt;
        yPos += vy * dt;
        driftT += dt;
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
            restCount = v.restFrames * p.restScale;
          }
        }
        rockVel += -rockZ * v.wobbleStiff * 0.5 * dt;
        rockVel *= 0.97;
        rockZ += rockVel * dt;
      }

      const xPos = p.drift * Math.sin(driftT * p.driftFreq);
      el.textContent = renderToss(angleX, tiltY, rockZ, yPos, xPos, grid, v, [lx, ly, lz]);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v, size, variant]);

  return (
    <pre
      ref={preRef}
      aria-hidden
      className={className}
      style={{
        color: 'var(--color-primary)',
        lineHeight: '1em',
        fontSize: size === 'lg' ? '0.46rem' : '0.62rem',
        letterSpacing: '0.06em',
        margin: 0,
        textShadow: '0 0 8px var(--color-primary)',
        fontFamily: 'var(--font-mono)',
        userSelect: 'none',
      }}
    />
  );
}
