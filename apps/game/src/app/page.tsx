import { CoinflipGame } from '../components/CoinflipGame.js';

export default function HomePage(): React.ReactElement {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-stone-800">
        <span className="text-amber-400 font-bold text-xl tracking-tight">fairground</span>
        <a href="/leaderboard" className="text-amber-400/60 hover:text-amber-400 text-sm transition-colors">
          Leaderboard
        </a>
      </nav>

      {/* Hero */}
      <div className="flex flex-col items-center pt-8 pb-4 px-4 text-center">
        <h1 className="text-4xl font-bold text-amber-400 mb-2">Coinflip</h1>
        <p className="text-amber-400/50 text-sm max-w-md">
          50/50 with 2% house edge. Every outcome derived from Applied Blockchain VRF beacon round.
          Verifiable on-chain.
        </p>
      </div>

      {/* Game */}
      <div className="flex-1">
        <CoinflipGame />
      </div>

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-amber-400/30 border-t border-stone-800">
        fairground.xyz -- provably fair on Algorand -- VRF beacon app {947_957_720}
      </footer>
    </main>
  );
}
