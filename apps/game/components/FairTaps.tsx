'use client';

/**
 * TapCoinField — the FAIR clicker surface (docs/design/fair-points-v1.md).
 *
 * Wraps the pending-phase coin: every pointerdown inside the field is a tap. The field (not
 * the WebGL mesh) is the hit target so a bouncing coin is still easy to hit on mobile; the
 * coin's own click-pop/drag behaviors keep working underneath. Renders the floating "+1"
 * particles, the one golden ×10 burst, and the session meter under the coin. The parent owns
 * syncing the count to the server — this component only counts and celebrates.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { sfx } from '../lib/sfx';
import { TAP_CAP, bankedTapPoints } from '../lib/fairPoints';

interface FloatItem {
  id: number;
  x: number;
  y: number;
  /** 'one' = counted +1, 'golden' = the ×10 tap, 'spark' = past the cap (style only). */
  kind: 'one' | 'golden' | 'spark';
  drift: number; // px of horizontal drift baked in at spawn
  tilt: number; // deg
}

export interface TapCoinFieldProps {
  /** Taps are counted only while true (the player's own flip is sealing). */
  active: boolean;
  /** This flip's hidden golden index (1-based) — null until computed / unavailable. */
  goldenIndex: number | null;
  /** Server-known tap count to resume from (recovery / second device). */
  primeRaw: number;
  /** Reports the raw tap total after every counted tap; the parent batches it upstream. */
  onCount: (raw: number) => void;
  /** Any value that changes per flip — resets the internal counters. */
  resetKey: string;
  children: ReactNode;
}

export function TapCoinField({
  active,
  goldenIndex,
  primeRaw,
  onCount,
  resetKey,
  children,
}: TapCoinFieldProps) {
  const rawRef = useRef(0);
  const [raw, setRaw] = useState(0);
  const [floats, setFloats] = useState<FloatItem[]>([]);
  const idRef = useRef(0);
  const combo = useRef({ n: 0, last: 0 });
  const [comboTier, setComboTier] = useState(0); // 0 quiet · 1 ≥10 · 2 ≥25 · 3 ≥50
  const comboDecay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [goldenBurst, setGoldenBurst] = useState(0); // increments to retrigger the ring
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // New flip → clean slate.
  useEffect(() => {
    rawRef.current = 0;
    combo.current = { n: 0, last: 0 };
    setRaw(0);
    setFloats([]);
    setComboTier(0);
    setGoldenBurst(0);
  }, [resetKey]);

  // Resume from the server-known count (recovery / second device): never backwards.
  useEffect(() => {
    if (primeRaw > rawRef.current) {
      rawRef.current = primeRaw;
      setRaw(primeRaw);
    }
  }, [primeRaw]);

  useEffect(
    () => () => {
      if (comboDecay.current) clearTimeout(comboDecay.current);
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active) return;
      const next = rawRef.current + 1;
      rawRef.current = next;
      setRaw(next);

      // Combo: taps under 1.2s apart chain; the glow tier eases off after a pause.
      const now = performance.now();
      combo.current = {
        n: now - combo.current.last < 1200 ? combo.current.n + 1 : 1,
        last: now,
      };
      const n = combo.current.n;
      setComboTier(n >= 50 ? 3 : n >= 25 ? 2 : n >= 10 ? 1 : 0);
      if (comboDecay.current) clearTimeout(comboDecay.current);
      comboDecay.current = setTimeout(() => setComboTier(0), 1800);

      const counted = next <= TAP_CAP;
      const isGolden = counted && goldenIndex !== null && next === goldenIndex;

      // Feel: sound + haptic. Golden gets its own sparkle and a triple buzz.
      if (isGolden) sfx.golden();
      else sfx.tap(n);
      try {
        if ('vibrate' in navigator) navigator.vibrate(isGolden ? [18, 40, 26] : 8);
      } catch {
        // haptics are a bonus, never a requirement
      }

      if (isGolden) setGoldenBurst((b) => b + 1);

      if (!reduceMotion.current) {
        const rect = e.currentTarget.getBoundingClientRect();
        const item: FloatItem = {
          id: idRef.current++,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          kind: counted ? (isGolden ? 'golden' : 'one') : 'spark',
          drift: (Math.random() - 0.5) * 26,
          tilt: (Math.random() - 0.5) * 12,
        };
        // Floats self-remove on animation end; the slice is a hard ceiling for 15 taps/s spam.
        setFloats((f) => [...f.slice(-24), item]);
      }

      if (counted) onCount(next);
    },
    [active, goldenIndex, onCount],
  );

  const removeFloat = useCallback((id: number) => {
    setFloats((f) => f.filter((i) => i.id !== id));
  }, []);

  const banked = bankedTapPoints(raw, goldenIndex);
  const maxed = raw >= TAP_CAP;

  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div
        className="relative select-none"
        style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        onPointerDown={handlePointerDown}
      >
        {children}

        {/* Golden ring — one expanding pulse from the center on the ×10 tap. */}
        {goldenBurst > 0 && <div key={goldenBurst} aria-hidden className="tap-golden-ring" />}

        {/* Floating rewards at the tap point. */}
        {floats.map((f) => (
          <div
            key={f.id}
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: f.x,
              top: f.y,
              transform: `translate(-50%, -50%) rotate(${f.tilt}deg)`,
            }}
          >
            <div
              className={f.kind === 'golden' ? 'tap-float-golden' : 'tap-float'}
              style={{ '--drift': `${f.drift}px` } as React.CSSProperties}
              onAnimationEnd={() => removeFloat(f.id)}
            >
              {f.kind === 'golden' ? (
                <span
                  className="font-mono text-xl font-black"
                  style={{
                    color: 'var(--color-primary)',
                    textShadow:
                      '0 0 14px oklch(0.78 0.18 65 / 0.9), 0 0 34px oklch(0.78 0.18 65 / 0.5)',
                  }}
                >
                  ×10
                </span>
              ) : f.kind === 'one' ? (
                <span
                  className="font-mono text-[15px] font-bold"
                  style={{
                    color: 'var(--color-primary)',
                    textShadow:
                      '0 0 10px oklch(0.78 0.18 65 / 0.7), 0 0 24px oklch(0.78 0.18 65 / 0.3)',
                  }}
                >
                  +1
                </span>
              ) : (
                <span className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  ·
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Session meter — fixed-height line so appearing/maxing never shifts the layout. */}
      <div
        className="flex h-5 items-center justify-center font-mono text-[11px] uppercase tracking-[0.25em]"
        aria-live="polite"
      >
        {raw === 0 ? (
          active && (
            <span className="tap-hint" style={{ color: 'var(--color-text-muted)' }}>
              [ tap the coin · +1 fair ]
            </span>
          )
        ) : (
          <span
            key={banked} // re-mount per change → pop animation retriggers
            className="tap-meter-pop tabular-nums"
            style={{
              color: 'var(--color-primary)',
              textShadow:
                comboTier === 0
                  ? 'none'
                  : comboTier === 1
                    ? '0 0 10px oklch(0.78 0.18 65 / 0.45)'
                    : comboTier === 2
                      ? '0 0 14px oklch(0.78 0.18 65 / 0.7)'
                      : '0 0 18px oklch(0.78 0.18 65 / 0.95), 0 0 40px oklch(0.78 0.18 65 / 0.4)',
            }}
          >
            ◈ +{banked} fair
            {maxed && (
              <span className="ml-2" style={{ color: 'var(--color-text-muted)' }}>
                · maxed
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
