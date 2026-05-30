import { WalletButton } from '../components/WalletButton';
import { CoinflipGame } from '../components/CoinflipGame';

export default function GamePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-start gap-8 px-4 py-10">
      <header className="flex w-full max-w-lg items-center justify-between">
        <span
          className="text-lg font-bold tracking-widest uppercase"
          style={{ color: 'var(--color-primary)' }}
        >
          Fairground
        </span>
        <WalletButton />
      </header>

      <section className="w-full max-w-lg">
        <CoinflipGame />
      </section>
    </main>
  );
}
