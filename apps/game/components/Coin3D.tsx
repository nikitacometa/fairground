'use client';

/**
 * Coin3D — a WebGL coin (react-three-fiber). In idle it spins in place like a two-sided medallion
 * logo (heads = the chosen meme face, tails = the Algorand mark), reacting to the pointer: click to
 * pop it up and spin it faster, or grab and drag to spin it by hand and fling it on release. During
 * the VRF wait it tumbles + hops; on resolve it settles onto the face that actually came up.
 *
 * An opt-in upgrade over the ASCII CoinTossScene; the ASCII coin stays the default + the fallback
 * (see Coin3DWrapper + the useCoin3DEnabled flag in CoinflipGame).
 *
 * Orientation: the cylinder caps face ±Y and the mesh is tilted rotation.x=π/2 so a cap faces the
 * camera. All spin is the GROUP's rotation.y about the world vertical — heads at y≡0, tails at y≡π —
 * so the coin reads as a logo turning to show each side. The outcome is decided by the backend VRF,
 * never by physics; settling only animates the visible path to the predetermined angle.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { useGesture } from '@use-gesture/react';
import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  type Group,
  type Mesh,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
} from 'three';

export type CoinVariant = 'coop' | 'woods' | 'anime';
export type CoinPhase = 'idle' | 'pending' | 'resolved';
export type CoinOutcome = 'heads' | 'tails';

const HEADS_TEXTURE: Record<CoinVariant, string> = {
  coop: '/coin/coop.webp',
  woods: '/coin/woods.webp',
  anime: '/coin/anime.webp',
};
const TAILS_TEXTURE = '/coin/algorand.webp';

// Shared geometry — one vertex buffer in GPU memory for every coin instance/variant.
const COIN_GEO = new CylinderGeometry(1, 1, 0.12, 64, 1, false);

const BASE_SPIN = 0.55; // idle medallion turn speed (rad/s) — a full turn ~11s
const PENDING_SPIN = 2.0; // spin while the bet resolves — lively but not a blur (was ~11, too fast)
const IDLE_TILT = 0.34; // constant forward tilt while spinning so the edge reads as a 3D ellipse
const HOP_VEL = 2.3; // auto-hop launch velocity during pending; peak ~0.27 world units (stays on-canvas)
const GRAVITY = 11;
const TAU = Math.PI * 2;

// Reeded-rim bump map: a sine ridge pattern around the circumference (milled edge) without
// subdividing geometry. Generated once on the client (needs document).
function makeReedBump(grooves = 90): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 16;
  const ctx = c.getContext('2d');
  if (ctx) {
    for (let x = 0; x < c.width; x++) {
      const v = (Math.sin((x / c.width) * Math.PI * 2 * grooves) * 0.5 + 0.5) * 255;
      ctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      ctx.fillRect(x, 0, 1, c.height);
    }
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  return tex;
}

const easeOutBack = (t: number, k = 1.3): number => {
  const c3 = k + 1;
  return 1 + c3 * (t - 1) ** 3 + k * (t - 1) ** 2;
};

interface CoinMeshProps {
  variant: CoinVariant;
  phase: CoinPhase;
  outcome: CoinOutcome | null;
}

function CoinMesh({ variant, phase, outcome }: CoinMeshProps) {
  const groupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);

  const headsTex = useLoader(TextureLoader, HEADS_TEXTURE[variant]);
  const tailsTex = useLoader(TextureLoader, TAILS_TEXTURE);
  // Normal map for the tails (Algorand) face — raised relief so the big 'A' catches the moving
  // light and reads as struck metal, not a flat decal. Normal maps stay in linear space.
  const tailsNormal = useLoader(TextureLoader, '/coin/algorand-normal.webp');
  useEffect(() => {
    for (const t of [headsTex, tailsTex]) t.colorSpace = SRGBColorSpace;
  }, [headsTex, tailsTex]);

  const reedBump = useMemo(() => makeReedBump(90), []);

  // [0] rim, [1] top cap (heads), [2] bottom cap (tails). Metal enough to glint, but the texture
  // still carries the gold relief; a bright emissive rim keeps the silhouette on the dark scene.
  const materials = useMemo(() => {
    const face = (map: typeof headsTex, normalMap?: typeof headsTex) =>
      new MeshPhysicalMaterial({
        color: new Color('#ffffff'),
        map,
        normalMap: normalMap ?? null,
        normalScale: new Vector2(1.4, 1.4),
        metalness: 0.85,
        roughness: 0.24,
        envMapIntensity: 1.4,
        clearcoat: 0.22,
        clearcoatRoughness: 0.1,
      });
    const rim = new MeshPhysicalMaterial({
      color: new Color('#caa050'),
      metalness: 1,
      roughness: 0.18,
      envMapIntensity: 2.0,
      emissive: new Color('#3a2408'),
      emissiveIntensity: 0.5,
      bumpMap: reedBump,
      bumpScale: 0.25,
      normalScale: new Vector2(0.6, 0.6),
    });
    return [rim, face(headsTex), face(tailsTex, tailsNormal)];
  }, [headsTex, tailsTex, tailsNormal, reedBump]);

  useEffect(
    () => () => {
      for (const m of materials) m.dispose();
      reedBump.dispose();
    },
    [materials, reedBump],
  );

  // ---- animation state (refs, mutated every frame) ----
  const spinVel = useRef(BASE_SPIN); // current group.rotation.y speed; eases back to BASE_SPIN
  const jumpVel = useRef(0); // vertical velocity from a click pop
  const tossT = useRef(0);
  const nextHop = useRef(0); // tossT at which the next auto-hop fires during pending
  const settleT = useRef(0);
  const fromY = useRef(0);
  const targetY = useRef(0);
  const settling = useRef(false);
  const drag = useRef({ y: 0, x: 0, vy: 0, active: false });

  useEffect(() => {
    if (phase !== 'resolved') {
      settling.current = false;
      settleT.current = 0;
    }
  }, [phase]);

  useFrame((_, rawDelta) => {
    const g = groupRef.current;
    if (!g) return;
    const delta = Math.min(rawDelta, 0.05);

    // Grab-and-drag overrides everything (idle inspection / hand-spin).
    if (drag.current.active) {
      g.rotation.y = drag.current.y;
      g.rotation.x = Math.max(-Math.PI / 5, Math.min(Math.PI / 5, drag.current.x));
      g.position.y = 0;
      return;
    }

    if (phase === 'pending') {
      // Medallion spin (slower now) + periodic low auto-hops through the ~30s VRF wait. The coin stays
      // clickable/draggable here (handleClick + the drag binder both allow pending) so you can poke and
      // hand-spin it while consensus runs. Hop height is low (~0.27) so it never leaves the canvas.
      tossT.current += delta;
      spinVel.current += (PENDING_SPIN - spinVel.current) * 0.02;
      g.rotation.y += spinVel.current * delta;
      g.rotation.x += (IDLE_TILT - g.rotation.x) * 0.05;
      // launch a fresh hop when grounded and not still rising from a click
      if (g.position.y <= 0.001 && jumpVel.current <= 0 && tossT.current >= nextHop.current) {
        jumpVel.current = HOP_VEL;
        nextHop.current = tossT.current + 1.5;
      }
      g.position.y += jumpVel.current * delta;
      jumpVel.current -= GRAVITY * delta;
      if (g.position.y < 0) {
        g.position.y = 0;
        jumpVel.current = jumpVel.current < -0.6 ? -jumpVel.current * 0.3 : 0;
      }
      return;
    }

    if (phase === 'resolved') {
      // Settle the spin onto the outcome face: heads = y≡0, tails = y≡π, plus a couple of turns so
      // it visibly winds down rather than snapping. easeOutBack lands it with a small bounce.
      if (!settling.current) {
        settling.current = true;
        settleT.current = 0;
        fromY.current = g.rotation.y;
        const faceBase = outcome === 'tails' ? Math.PI : 0;
        const k = Math.ceil((g.rotation.y + Math.PI * 4 - faceBase) / TAU);
        targetY.current = faceBase + k * TAU;
      }
      settleT.current += delta;
      const t = Math.min(settleT.current / 1.1, 1);
      const eased = easeOutBack(t);
      g.rotation.y = fromY.current + (targetY.current - fromY.current) * eased;
      g.rotation.x = Math.sin(t * Math.PI) * 0.08 * (1 - t);
      g.position.y = Math.max(0, Math.sin(t * Math.PI) * 0.3 * (1 - t));
      if (t >= 1) {
        g.rotation.y = targetY.current;
        g.rotation.x = 0;
        g.position.y = 0;
      }
      return;
    }

    // ---- idle: medallion spin in place, held at a constant tilt so the edge is never a flat line;
    // click pops + boosts the spin ----
    spinVel.current += (BASE_SPIN - spinVel.current) * 0.018; // ease boost back down to base
    g.rotation.y += spinVel.current * delta;
    g.rotation.x += (IDLE_TILT - g.rotation.x) * 0.06;

    if (jumpVel.current !== 0 || g.position.y > 0.001) {
      g.position.y += jumpVel.current * delta;
      jumpVel.current -= 11 * delta;
      if (g.position.y <= 0) {
        g.position.y = 0;
        jumpVel.current = jumpVel.current < -0.6 ? -jumpVel.current * 0.32 : 0;
      }
    } else {
      g.position.y = 0;
    }
  });

  const handleClick = () => {
    if (phase === 'resolved') return; // poke-able in idle AND while the bet is pending
    // pop up + kick the spin — the coin "comes alive" when you poke it
    jumpVel.current = 3.4;
    spinVel.current = Math.min(spinVel.current + 9, 16);
  };

  const bind = useGesture({
    onDragStart: () => {
      if (phase === 'resolved' || !groupRef.current) return; // grabbable in idle AND pending
      drag.current.active = true;
      drag.current.y = groupRef.current.rotation.y;
      drag.current.x = groupRef.current.rotation.x;
      drag.current.vy = 0;
    },
    onDrag: ({ delta: [dx, dy] }) => {
      if (!drag.current.active) return;
      drag.current.y += dx * 0.012;
      drag.current.x += dy * 0.012;
      drag.current.vy = dx * 0.012; // remember last motion for the fling
    },
    onDragEnd: () => {
      if (!drag.current.active) return;
      drag.current.active = false;
      // fling: carry the drag motion into the idle spin, clamped to a lively range
      const fling = drag.current.vy * 55;
      spinVel.current = Math.max(-14, Math.min(14, BASE_SPIN + fling));
    },
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        geometry={COIN_GEO}
        material={materials}
        rotation={[Math.PI / 2, 0, 0]}
        onClick={handleClick}
        {...bind()}
      />
    </group>
  );
}

export interface Coin3DProps {
  variant?: CoinVariant;
  phase?: CoinPhase;
  outcome?: CoinOutcome | null;
  /** px height of the canvas box. */
  size?: number;
}

export default function Coin3D({
  variant = 'coop',
  phase = 'idle',
  outcome = null,
  size = 176,
}: Coin3DProps) {
  // Pause the render loop when scrolled off-screen.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setActive(e?.isIntersecting ?? true), {
      threshold: 0.05,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={wrapRef} style={{ width: size, height: size, touchAction: 'none', cursor: 'grab' }}>
      <Canvas
        frameloop={active ? 'always' : 'never'}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 38, near: 0.1, far: 50, position: [0, 0.2, 4.1] }}
      >
        <ambientLight color={'#1a1005'} intensity={0.45} />
        {/* warm key from top-right — the principal highlight */}
        <directionalLight color={'#ffcf70'} intensity={3.0} position={[3, 5, 2]} />
        {/* cool rim from behind-left — separates the coin from the dark bg, catches the edge */}
        <directionalLight color={'#4a6aa0'} intensity={0.9} position={[-4, 1, -3]} />
        {/* frontal point light — a tight specular glint that travels across the struck face */}
        <pointLight
          color={'#fff3da'}
          intensity={22}
          distance={14}
          decay={2}
          position={[0.8, 1.2, 2.6]}
        />
        <Environment preset="studio" environmentIntensity={0.5} />
        <CoinMesh variant={variant} phase={phase} outcome={outcome} />
      </Canvas>
    </div>
  );
}
