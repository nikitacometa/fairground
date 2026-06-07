import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { ProofCardData } from '@fairground/types';
import { VrfResultCard } from './templates/VrfResultCard.js';
import { sizes } from './theme.js';

// Font loading -- satori requires font buffers at runtime
// Place IBM Plex Mono fonts in packages/proof-card/assets/fonts/
// Download from: https://fonts.google.com/specimen/IBM+Plex+Mono
function loadFont(name: string): ArrayBuffer {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const fontPath = join(__dir, '..', 'assets', 'fonts', name);
  return readFileSync(fontPath).buffer;
}

let fontsCache: Array<{
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: 'normal';
}> | null = null;

function getSatoriFonts(): typeof fontsCache {
  if (fontsCache) return fontsCache;
  try {
    fontsCache = [
      {
        name: 'IBM Plex Mono',
        data: loadFont('IBMPlexMono-Regular.ttf'),
        weight: 400,
        style: 'normal',
      },
      {
        name: 'IBM Plex Mono',
        data: loadFont('IBMPlexMono-Bold.ttf'),
        weight: 700,
        style: 'normal',
      },
    ];
  } catch {
    // If fonts not present, satori will use system fallback (may look wrong)
    console.warn('proof-card: font files not found in assets/fonts/ -- output may look incorrect');
    fontsCache = [];
  }
  return fontsCache;
}

// Raster assets (GPT Image 2) — the minted seal and the guilloché background. Each is loaded once
// as a base64 data URI and embedded via <img>; both are optional and never fail the card.
function loadAsset(file: string): string | null {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const buf = readFileSync(join(__dir, '..', 'assets', file));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

let sealCache: string | null | undefined;
function getSeal(): string | undefined {
  if (sealCache === undefined) sealCache = loadAsset('seal.png');
  return sealCache ?? undefined;
}

let bgCache: string | null | undefined;
function getBg(): string | undefined {
  if (bgCache === undefined) bgCache = loadAsset('guilloche.png');
  return bgCache ?? undefined;
}

export interface GenerateProofCardOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  variant?: 'landscape' | 'square';
  /** Full wallet address of the card owner — encoded in the QR so a scan refers to them. */
  referrerAddress?: string;
}

/**
 * Generate a VRF proof card PNG for a resolved coin flip.
 *
 * @param data    - Proof card data from the resolved bet
 * @param options - Output format options
 * @returns PNG or JPEG buffer
 */
export async function generateProofCard(
  data: ProofCardData,
  options: GenerateProofCardOptions = {},
): Promise<Buffer> {
  const { format = 'png', quality = 95, variant = 'landscape' } = options;
  const { width, height } = variant === 'landscape' ? sizes.card : sizes.square;

  // Referral code + QR — turns the proof card into a viral play-loop. The code is derived
  // from the wallet prefix; the QR points at the game with the referral pre-filled.
  const refCode =
    (data.walletPrefix || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 6)
      .toUpperCase() || 'PLAY00';
  // Encode the full wallet when available (real attribution), else the short code.
  const refTarget = options.referrerAddress ?? refCode;
  let qr: string | undefined;
  try {
    qr = await QRCode.toDataURL(`https://app.fairground.quest/?ref=${refTarget}`, {
      width: 412,
      margin: 1,
      color: { dark: '#d4963a', light: '#0b0805' },
    });
  } catch {
    qr = undefined; // QR is a nice-to-have; never fail the card over it
  }

  const element = VrfResultCard({ data, qr, refCode, seal: getSeal(), bg: getBg() });

  // 1. JSX -> SVG via satori
  const svg = await satori(element, {
    width,
    height,
    fonts: getSatoriFonts() ?? [],
  });

  // 2. SVG -> PNG via @resvg/resvg-js
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  const rendered = resvg.render();
  const pngBuffer = rendered.asPng();

  // 3. Add an outcome-tinted border frame via sharp — green for a win, crimson for a loss, so the
  // two outcomes are tellable apart by the frame alone at thumbnail size.
  const frameColor = data.outcome === 'tails' ? 'rgba(196,48,48,0.6)' : 'rgba(62,184,106,0.6)';
  // Wide enough (12px) to survive Twitter JPEG downscaling — at ~280px thumbnail a 6px frame
  // vanished; 12px still registers as a green/crimson color signal.
  const borderSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${width}" height="${height}"
      fill="none"
      stroke="${frameColor}"
      stroke-width="12" />
  </svg>`;

  const output = await sharp(Buffer.from(pngBuffer))
    .composite([{ input: Buffer.from(borderSvg), blend: 'over' }])
    .toFormat(format, format === 'jpeg' ? { quality, progressive: true } : {})
    .toBuffer();

  return output;
}

export { colors, sizes, outcomeColor, outcomeLabel } from './theme.js';
export type { FlipOutcome } from './theme.js';

// React component (all styles inline, so it also renders in the browser).
export { VrfResultCard } from './templates/VrfResultCard.js';
