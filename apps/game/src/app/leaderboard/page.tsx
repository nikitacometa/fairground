// Leaderboard RSC -- fetches from @fairground/api at build/request time
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Leaderboard -- Fairground',
};

interface LeaderboardRow {
  rank: number;
  walletAddress: string;
  wins: string;
  losses: string;
  netPnlMicroalgo: string;
  totalVolumeMicroalgo: string;
  gamesPlayed: string;
}

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010';

async function getLeaderboard(): Promise<LeaderboardRow[]> {
  try {
    const res = await fetch(`${API_URL}/leaderboard?limit=50`, {
      next: { revalidate: 30 }, // Revalidate every 30 seconds (Next.js ISR)
    });
    if (!res.ok) return [];
    return (await res.json()) as LeaderboardRow[];
  } catch {
    return [];
  }
}

export default async function LeaderboardPage(): Promise<React.ReactElement> {
  const rows = await getLeaderboard();

  const microToAlgo = (micro: string): string => {
    const n = Number(micro) / 1_000_000;
    const sign = n >= 0 ? '+' : '';
    return `${sign}${n.toFixed(2)} ALGO`;
  };

  return (
    <main className="min-h-screen px-4 py-8">
      <nav className="mb-8">
        <a href="/" className="text-amber-400 font-bold text-xl tracking-tight">fairground</a>
      </nav>

      <h1 className="text-3xl font-bold text-amber-400 mb-6">Leaderboard</h1>

      {rows.length === 0 ? (
        <p className="text-amber-400/50">No games played yet. Be the first.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 text-amber-400/50">
                <th className="text-left py-2 pr-4">#</th>
                <th className="text-left py-2 pr-4">Wallet</th>
                <th className="text-right py-2 pr-4">Games</th>
                <th className="text-right py-2 pr-4">W/L</th>
                <th className="text-right py-2">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pnl = Number(row.netPnlMicroalgo);
                return (
                  <tr key={row.walletAddress} className="border-b border-stone-900 hover:bg-stone-900/30">
                    <td className="py-3 pr-4 text-amber-400/40">{row.rank}</td>
                    <td className="py-3 pr-4 font-mono">
                      {row.walletAddress.slice(0, 8)}...{row.walletAddress.slice(-6)}
                    </td>
                    <td className="py-3 pr-4 text-right text-amber-400/70">{row.gamesPlayed}</td>
                    <td className="py-3 pr-4 text-right text-amber-400/70">
                      {row.wins}/{row.losses}
                    </td>
                    <td className={`py-3 text-right font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {microToAlgo(row.netPnlMicroalgo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
