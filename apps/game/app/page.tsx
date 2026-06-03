import { WalletButton } from '../components/WalletButton';
import { CoinflipGame } from '../components/CoinflipGame';
import FloatingCoins from '../components/FloatingCoins';

// ?demo=win|loss runs the wallet-free walkthrough; otherwise the real wallet flow.
export default async function GamePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { demo } = await searchParams;
  const demoOutcome = demo === 'loss' ? 'loss' : demo !== undefined ? 'win' : null;

  return (
    <>
      <FloatingCoins />
      <main className="relative z-10 flex min-h-dvh flex-col items-center justify-start gap-8 px-4 py-10">
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

        <footer className="mt-4 flex w-full max-w-lg flex-col items-center gap-3 text-center">
          <div
            className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-text-dim)' }}
          >
            <a
              href="https://fairground.quest/#how-it-works"
              className="transition-opacity hover:opacity-70"
            >
              How it Works
            </a>
            <a
              href="https://allo.info/application/3584300812"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-opacity hover:opacity-70"
            >
              Verify Contract
            </a>
            <a
              href="https://x.com/fairground_xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-opacity hover:opacity-70"
            >
              X / Twitter
            </a>
          </div>
          <p
            className="text-[10px] uppercase leading-relaxed tracking-[0.15em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Provably fair on Algorand · every outcome verifiable on-chain
          </p>
        </footer>
      </main>
    </>
  );
}
