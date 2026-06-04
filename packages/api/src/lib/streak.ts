import { db, bets } from '@fairground/db';
import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';

/**
 * Count consecutive wins ending at (and including) the resolved flip nearest `resolvedAt`, scoped to
 * a single game. A loss breaks the streak (returns 0 at the head). Walks the wallet's resolved
 * `gameId` flips back from that time. Pass `new Date()` for the player's current live streak; pass a
 * bet's resolvedAt for the streak as it stood at that flip (the proof-card badge). The gameId scope
 * keeps a future game's results from polluting another game's streak. Shared by the proof card and
 * GET /games/:gameId/streak/:address.
 */
export async function computeWinStreak(
  walletAddress: string,
  resolvedAt: Date | null,
  gameId: string,
): Promise<number> {
  if (!resolvedAt) return 0;
  const recent = await db
    .select({ outcome: bets.outcome })
    .from(bets)
    .where(
      and(
        eq(bets.walletAddress, walletAddress),
        eq(bets.gameId, gameId),
        isNotNull(bets.resolvedAt),
        lte(bets.resolvedAt, resolvedAt),
      ),
    )
    .orderBy(desc(bets.resolvedAt))
    .limit(50);
  let streak = 0;
  for (const row of recent) {
    if (row.outcome === 'win') streak += 1;
    else break;
  }
  return streak;
}
