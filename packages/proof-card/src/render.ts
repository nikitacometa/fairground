/**
 * Satori → @resvg/resvg-js → sharp rendering pipeline.
 *
 * Mirrors the beef-web generator.ts pipeline.
 * Returns a PNG Buffer for a given ProofCardData + format.
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProofCardData } from '@fairground/types';
import { VrfResultCard } from './templates/VrfResultCard.js';
import { sizes, type CardFormat } from './theme.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(__dirname, '../assets/fonts');

// Fonts loaded once at module init — reused across all satori calls.
// Place font files in packages/proof-card/assets/fonts/ before first use.
// Recommended: IBM Plex Mono (matches beef-web pipeline).
let _fonts: Parameters<typeof satori>[1]['fonts'] | null = null;

function loadFonts(): Parameters<typeof satori>[1]['fonts'] {
  if (_fonts) return _fonts;

  const tryLoad = (file: string): Buffer | null => {
    try {
      return readFileSync(join(FONTS_DIR, file));
    } catch {
      return null;
    }
  };

  const regular = tryLoad('IBMPlexMono-Regular.ttf');
  const semiBold = tryLoad('IBMPlexMono-SemiBold.ttf');
  const bold = tryLoad('IBMPlexMono-Bold.ttf');

  if (!regular || !semiBold || !bold) {
    throw new Error(
      'Font files missing. Copy IBMPlexMono-Regular.ttf, IBMPlexMono-SemiBold.ttf, ' +
        'IBMPlexMono-Bold.ttf into packages/proof-card/assets/fonts/ before rendering.',
    );
  }

  _fonts = [
    { name: 'IBM Plex Mono', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'IBM Plex Mono', data: semiBold, weight: 600 as const, style: 'normal' as const },
    { name: 'IBM Plex Mono', data: bold, weight: 700 as const, style: 'normal' as const },
  ];

  return _fonts;
}

export interface RenderOptions {
  format?: CardFormat;
}

/**
 * Render a VRF result proof card to a PNG buffer.
 *
 * Pipeline:
 *   1. React element → SVG string via satori
 *   2. SVG → PNG via @resvg/resvg-js (headless Rust renderer)
 *   3. PNG → final PNG via sharp (add frame border, optimize)
 *
 * @param data     ProofCardData with all fields populated
 * @param options  format: 'landscape' (1600x900) | 'square' (1200x1200)
 * @returns PNG buffer
 */
export async function renderProofCard(
  data: ProofCardData,
  options: RenderOptions = {},
): Promise<Buffer> {
  const format = options.format ?? 'landscape';
  const { width, height } = sizes[format];

  const element = React.createElement(VrfResultCard, { data, format });

  // 1. JSX → SVG
  const svg = await satori(element, {
    width,
    height,
    fonts: loadFonts(),
  });

  // 2. SVG → PNG via resvg
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
  });
  const rendered = resvg.render();
  const rawPng = rendered.asPng();

  // 3. PNG via sharp — add thin amber border frame
  const output = await sharp(rawPng)
    .extend({
      top: 2,
      bottom: 2,
      left: 2,
      right: 2,
      background: { r: 212, g: 168, b: 67, alpha: 0.6 }, // primary amber at 60%
    })
    .resize(width, height) // crop back to exact dimensions
    .png()
    .toBuffer();

  return output;
}
