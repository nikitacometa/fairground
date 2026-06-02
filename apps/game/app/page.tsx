import { WalletButton } from '../components/WalletButton';
import { CoinflipGame } from '../components/CoinflipGame';

// ?demo=win|loss runs the wallet-free walkthrough; otherwise the real wallet flow.
export default async function GamePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { demo } = await searchParams;
  const demoOutcome = demo === 'loss' ? 'loss' : demo !== undefined ? 'win' : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-start gap-8 px-4 py-10">
      <header className="flex w-full max-w-lg items-center justify-between">
        <a
          href="https://fairground.quest"
          className="text-lg font-bold tracking-[0.3em] uppercase transition-opacity hover:opacity-80"
          style={{ color: 'var(--color-primary)' }}
        >
          Fairground
        </a>
        <WalletButton />
      </header>

      <section className="w-full max-w-lg">
        <CoinflipGame demoOutcome={demoOutcome} />
      </section>

      <footer
        className="mt-2 w-full max-w-lg text-center text-[10px] uppercase leading-relaxed tracking-[0.15em]"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <p>Provably fair on Algorand · every outcome verifiable on-chain</p>
        <p className="mt-1" style={{ opacity: 0.55 }}>
          Not available in US, UK, TH, ID, IN, BR · 18+ · crypto only
        </p>
      </footer>
    </main>
  );
}
