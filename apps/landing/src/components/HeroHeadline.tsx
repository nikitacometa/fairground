/**
 * HeroHeadline — the hero H1 rendered as a per-character terminal type-on. Each glyph
 * fades up on a staggered delay; a block cursor blinks after the last character. The
 * animation is pure CSS (runs on the SSR'd spans at load, no hydration wait). The visible
 * spans are aria-hidden and the real text is exposed via aria-label, so screen readers and
 * crawlers see "Provably Fair. On-chain." as one heading.
 *
 * Characters are grouped into non-breaking word spans with breakable spaces between them,
 * so the headline wraps between words (never mid-word) on narrow viewports.
 * Reduced-motion: the per-char animation is disabled in global.css.
 */
import type { CSSProperties, ReactNode } from 'react';

const LINE_ONE = 'Provably Fair.';
const LINE_TWO = 'On-chain.';

function renderLine(text: string, startIndex: number): ReactNode[] {
  const words = text.split(' ');
  let charIndex = startIndex;
  const nodes: ReactNode[] = [];

  words.forEach((word, wi) => {
    const chars = word.split('').map((ch) => {
      const idx = charIndex++;
      return (
        <span key={`c-${idx}`} className="char-in" style={{ '--ci': idx } as CSSProperties}>
          {ch}
        </span>
      );
    });
    // Word stays together (no mid-word break); the gap below is the break opportunity.
    nodes.push(
      <span key={`w-${wi}`} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
        {chars}
      </span>,
    );
    if (wi < words.length - 1) {
      nodes.push(' '); // breakable whitespace between words
      charIndex++; // keep stagger timing even across the inter-word gap
    }
  });

  return nodes;
}

export default function HeroHeadline() {
  return (
    <h1
      aria-label={`${LINE_ONE} ${LINE_TWO}`}
      className="text-5xl md:text-7xl font-black text-amber-400 leading-none tracking-tight"
    >
      <span aria-hidden="true" style={{ display: 'block' }}>
        {renderLine(LINE_ONE, 0)}
      </span>
      <span aria-hidden="true" style={{ display: 'block', color: 'oklch(0.78 0.18 65 / 0.6)' }}>
        {renderLine(LINE_TWO, LINE_ONE.length + 1)}
        <span className="cursor-blink" style={{ marginLeft: 3 }}>
          █
        </span>
      </span>
    </h1>
  );
}
