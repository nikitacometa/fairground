/**
 * sfx — a tiny zero-dependency Web Audio sound engine for game-feel. Every sound is
 * synthesized procedurally from oscillators + envelopes (no audio files, no bundle cost),
 * which is itself on-brand: the audio equivalent of the ASCII coin.
 *
 * The AudioContext is created lazily on the first user gesture (the flip/pick click) and
 * reused. A persisted mute flag is honoured before anything plays. Nothing ever fires on
 * page load — browsers require a gesture to start audio.
 */

let ctx: AudioContext | null = null;
let muted = false;

type AudioCtor = typeof AudioContext;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC: AudioCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setMuted(value: boolean): void {
  muted = value;
}

/** Unlock/resume the AudioContext from within a user-gesture handler. */
export function primeAudio(): void {
  getCtx();
}

interface ToneOpts {
  type: OscillatorType;
  freq: number;
  freqTo?: number;
  vol: number;
  dur: number;
  attack?: number;
  delay?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
  detune?: number;
}

// Schedule a single oscillator voice with an attack/exponential-decay envelope.
function tone(o: ToneOpts): void {
  const c = getCtx();
  if (!c || muted) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = o.type;
  if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqTo), t0 + o.dur);

  const attack = o.attack ?? 0.005;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(o.vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  if (o.filter) {
    const f = c.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.setValueAtTime(o.filter.freq, t0);
    if (o.filter.q) f.Q.setValueAtTime(o.filter.q, t0);
    osc.connect(f);
    f.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.03);
}

export const sfx = {
  /** Short UI blip on button presses. */
  tick(): void {
    tone({ type: 'sine', freq: 880, vol: 0.05, dur: 0.04 });
  },
  /** Airy rising whoosh as the coin is launched. */
  toss(): void {
    tone({
      type: 'sawtooth',
      freq: 240,
      freqTo: 760,
      vol: 0.12,
      dur: 0.26,
      filter: { type: 'bandpass', freq: 700, q: 1.2 },
    });
  },
  /** Bright metallic clink when the coin bounces off the table. */
  clink(): void {
    tone({ type: 'triangle', freq: 1500, vol: 0.16, dur: 0.13 });
    tone({ type: 'triangle', freq: 2080, detune: 8, vol: 0.09, dur: 0.1, delay: 0.005 });
  },
  /** Rising three-note chime on a win. */
  win(): void {
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((f, i) =>
      tone({ type: 'sine', freq: f, vol: 0.16, dur: 0.42, attack: 0.008, delay: i * 0.085 }),
    );
    tone({ type: 'triangle', freq: 1567.98, vol: 0.06, dur: 0.5, delay: 0.17 }); // G6 shimmer
  },
  /** Coin-tap blip for the FAIR clicker — pitch climbs with the combo so a streak sings. */
  tap(combo = 0): void {
    const freq = 660 + Math.min(combo, 40) * 14; // 660Hz → ~1220Hz across a 40-tap streak
    tone({ type: 'sine', freq, vol: 0.045, dur: 0.035 });
  },
  /** Golden-tap sparkle — a quick bright two-note ping above the regular tap blip. */
  golden(): void {
    tone({ type: 'triangle', freq: 1318.5, vol: 0.14, dur: 0.16 }); // E6
    tone({ type: 'triangle', freq: 1975.5, vol: 0.1, dur: 0.22, delay: 0.06 }); // B6
  },
  /** Dull low thud on a loss. */
  loss(): void {
    tone({
      type: 'square',
      freq: 92,
      freqTo: 58,
      vol: 0.2,
      dur: 0.36,
      filter: { type: 'lowpass', freq: 220 },
    });
  },
};
