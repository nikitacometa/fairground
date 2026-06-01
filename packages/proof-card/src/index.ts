import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { ProofCardData } from '@fairground/types';
import { VrfResultCard } from './templates/VrfResultCard.js';
import { sizes, colors } from './theme.js';

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

export interface GenerateProofCardOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  variant?: 'landscape' | 'square';
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

  const element = VrfResultCard({ data });

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

  // 3. Add amber border frame via sharp
  const borderSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${width}" height="${height}"
      fill="none"
      stroke="${colors.borderFrame}"
      stroke-width="6" />
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
