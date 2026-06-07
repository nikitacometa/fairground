'use client';

/**
 * Coin3D — a WebGL coin (react-three-fiber) that tumbles during the VRF wait and settles onto the
 * resolved face. An opt-in upgrade over the ASCII CoinTossScene; the ASCII coin stays the default
 * and the fallback (see Coin3DWrapper + the useCoin3DEnabled flag in CoinflipGame).
 *
 * Geometry: one CylinderGeometry (3 material groups: rim / heads / tails) + two thin bevel tori for
 * the struck-edge crescent. Heads face = the chosen meme variant ($COOP / Woods / anime); tails is
 * always the Algorand mark. Faces are GPT-Image gold-relief textures in /public/coin/.
 *
 * Animation is a hand-rolled state machine in useFrame (no spring dep): idle bob → toss loop while
 * pending → slerp-settle to the outcome face on resolve. The outcome is decided by the backend VRF,
 * never by physics — settling only animates the visible path to a predetermined quaternion.
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
// The cylinder's caps point along ±Y; we orient the mesh so a cap faces the camera (see HEADS_UP).
const COIN_GEO = new CylinderGeometry(1, 1, 0.12, 64, 1, false);

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

// The cylinder caps face ±Y; rotation.x = +π/2 turns the TOP cap (heads) toward the camera (+Z),
// −π/2 turns the BOTTOM cap (tails) toward it. The settle in useFrame eases rotation.x onto the
// outcome's face value (+ whole turns) — see the resolved branch.

const easeOutBack = (t: number, k = 1.4): number => {
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
  useEffect(() => {
    for (const t of [headsTex, tailsTex]) t.colorSpace = SRGBColorSpace;
  }, [headsTex, tailsTex]);

  const reedBump = useMemo(() => makeReedBump(90), []);

  // [0] rim, [1] top cap (heads), [2] bottom cap (tails). metalness 1, polished face vs milled rim.
  const materials = useMemo(() => {
    // The face texture already encodes the gold relief + lighting, so the material is mostly a
    // gentle metal sheen over it — high envMapIntensity would blow the texture out to white.
    // Metal enough to catch the env + point-light glint, but the texture still carries the gold
    // relief — too high a metalness mirrors the env and washes the emblem out.
    const face = (map: typeof headsTex) =>
      new MeshPhysicalMaterial({
        color: new Color('#ffffff'),
        map,
        metalness: 0.85,
        roughness: 0.24,
        envMapIntensity: 1.4,
        clearcoat: 0.22,
        clearcoatRoughness: 0.1,
      });
    // Bright milled rim with a faint warm emissive so the coin keeps a visible gold silhouette
    // against the near-black scene (the rim was dissolving into the background).
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
    return [rim, face(headsTex), face(tailsTex)];
  }, [headsTex, tailsTex, reedBump]);

  useEffect(
    () => () => {
      for (const m of materials) m.dispose();
      reedBump.dispose();
    },
    [materials, reedBump],
  );

  // ---- animation state (refs, not React state — mutated every frame) ----
  const tossT = useRef(0); // toss-loop clock
  const settleT = useRef(0); // settle clock
  const fromX = useRef(0); // rotation.x at settle start
  const targetX = useRef(Math.PI / 2); // rotation.x to settle onto (outcome face)
  const settling = useRef(false);
  const impulse = useRef({ spin: 0, bounce: 0 });
  const dragRot = useRef({ x: Math.PI / 2, y: 0, active: false });

  // Reset the settle latch whenever we leave the resolved phase (e.g. a new flip).
  useEffect(() => {
    if (phase !== 'resolved') {
      settling.current = false;
      settleT.current = 0;
    }
  }, [phase]);

  // A "face" shows whenever rotation.x ≡ ±π/2 (mod 2π) — every π the coin presents a side.
  const nearestFace = (x: number): number =>
    Math.round((x - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;

  useFrame((_, rawDelta) => {
    const g = groupRef.current;
    const m = meshRef.current;
    if (!g || !m) return;
    const delta = Math.min(rawDelta, 0.05); // clamp tab-switch spikes
    const now = performance.now() * 0.001;

    // Drag overrides everything while the pointer is down (idle inspection).
    if (dragRot.current.active) {
      m.rotation.set(dragRot.current.x, dragRot.current.y, 0);
      g.position.y = 0;
      return;
    }

    if (phase === 'pending') {
      // Continuous flip loop through the ~30s VRF wait: a 1.4s parabola hop while the coin tumbles
      // about its flip axis (X). Faster mid-arc reads as a "held breath" at the apex.
      tossT.current += delta;
      const period = 1.4;
      const t = (tossT.current % period) / period;
      g.position.y = 4 * 0.85 * t * (1 - t);
      m.rotation.x += delta * (6 + 3 * Math.sin(t * Math.PI));
      m.rotation.z = Math.sin(tossT.current * 4) * 0.07;
      m.rotation.y = 0;
      return;
    }

    if (phase === 'resolved') {
      // One-time settle: ease rotation.x from the tumble pose onto the predetermined outcome face
      // (heads = +π/2, tails = −π/2, plus whole turns) with a small landing bounce. The outcome is
      // fixed before the animation — physics only draws the path, never decides the face.
      if (!settling.current) {
        settling.current = true;
        settleT.current = 0;
        fromX.current = m.rotation.x;
        const faceBase = outcome === 'tails' ? -Math.PI / 2 : Math.PI / 2;
        // smallest faceBase + k·2π that is ≥ current + ~1.5 extra turns (a visible wind-down)
        const k = Math.ceil((m.rotation.x + Math.PI * 3 - faceBase) / (Math.PI * 2));
        targetX.current = faceBase + k * Math.PI * 2;
      }
      settleT.current += delta;
      const t = Math.min(settleT.current / 1.0, 1);
      const eased = easeOutBack(t);
      m.rotation.x = fromX.current + (targetX.current - fromX.current) * eased;
      m.rotation.z = Math.sin(t * Math.PI) * 0.05 * (1 - t);
      m.rotation.y = 0;
      g.position.y = Math.max(0, Math.sin(t * Math.PI) * 0.3 * (1 - t));
      if (t >= 1) {
        m.rotation.x = targetX.current;
        g.position.y = 0;
      }
      return;
    }

    // idle: click-impulse flip-spin decay, else rest on the nearest face with a breathing wobble.
    const imp = impulse.current;
    if (Math.abs(imp.spin) > 0.001 || Math.abs(imp.bounce) > 0.001) {
      m.rotation.x += imp.spin * delta;
      m.rotation.z = 0;
      m.rotation.y = 0;
      g.position.y += imp.bounce * delta;
      imp.bounce -= 9.8 * delta;
      if (g.position.y < 0) {
        g.position.y = 0;
        imp.bounce = Math.abs(imp.bounce) * 0.4;
        if (imp.bounce < 0.3) imp.bounce = 0;
      }
      imp.spin *= 0.94;
      if (Math.abs(imp.spin) < 0.05 && imp.bounce === 0) imp.spin = 0;
    } else {
      m.rotation.x += (nearestFace(m.rotation.x) - m.rotation.x) * 0.08; // settle to a face
      m.rotation.y = Math.sin(now * 0.6) * 0.32; // breathing tilt — shows a flash of thickness
      m.rotation.z = Math.sin(now * 0.4) * 0.03;
      g.position.y = Math.sin(now * 0.8) * 0.04;
    }
  });

  const bind = useGesture({
    onDragStart: () => {
      if (phase !== 'idle' || !meshRef.current) return;
      dragRot.current.active = true;
      dragRot.current.x = meshRef.current.rotation.x;
      dragRot.current.y = meshRef.current.rotation.y;
    },
    onDrag: ({ delta: [dx, dy] }) => {
      if (!dragRot.current.active) return;
      dragRot.current.y += dx * 0.012;
      dragRot.current.x = Math.max(
        -Math.PI / 4,
        Math.min(Math.PI / 4, dragRot.current.x + dy * 0.012),
      );
    },
    onDragEnd: () => {
      dragRot.current.active = false;
    },
  });

  const handleClick = () => {
    if (phase !== 'idle') return;
    impulse.current.spin = 9; // a quick flip burst — "dink" the coin and it tumbles, then re-settles
    impulse.current.bounce = 2.6;
  };

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
    <div ref={wrapRef} style={{ width: size, height: size, touchAction: 'none' }}>
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
