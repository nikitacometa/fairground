/**
 * Astro island wrapper for the signature ASCII coin. Default export so it can be
 * hydrated in Hero.astro via `<AsciiCoinIsland client:load />`.
 */
import { AsciiCoin } from './AsciiCoin';

export default function AsciiCoinIsland() {
  return <AsciiCoin size="lg" spinning />;
}
