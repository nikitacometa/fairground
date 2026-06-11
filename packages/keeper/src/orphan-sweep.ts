/**
 * Orphan flip-box sweep — the server-side safety net for flips the client never reported.
 *
 * A flip is "orphaned" when its group confirmed on-chain but recordBet never reached the API:
 * iOS Safari kills in-flight fetches on app-switch to the wallet, tabs close mid-submit, radios
 * drop. The contract escrows the stake in its flip box either way; without a DB session the
 * keeper is blind and the player waits 48h for the refund backdoor (real incident 2026-06-11:
 * a 20-ALGO flip stranded for ~1h, registered by hand minutes before the beacon window closed).
 *
 * The sweep makes the chain itself the source of truth: every Nth tick, list the coinflip app's
 * boxes; any `flip:` box without a matching (wallet, commit_round) session gets a synthesized
 * bet + session built from the box contents, and the normal resolver settles it on the next
 * tick. playerPick stays null (it never existed on-chain) — the feed already renders null-pick
 * rows without a side, and recordBet adopts the pick retroactively if the client reconnects.
 */

import { and, eq } from 'drizzle-orm';
import { db, bets, sessions } from '@fairground/db';
import type { Logger } from 'pino';
import { env } from './env.js';
import { FLIP_PREFIX, parseFlipBox } from './flip-box.js';

function algodHeaders(): Record<string, string> {
  return env.ALGOD_TOKEN ? { 'X-Algo-API-Token': env.ALGOD_TOKEN } : {};
}

async function listFlipBoxNames(appId: bigint): Promise<Uint8Array[]> {
  const res = await fetch(`${env.ALGOD_URL}/v2/applications/${appId.toString()}/boxes`, {
    headers: algodHeaders(),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`algod boxes list returned ${res.status}`);
  const body = (await res.json()) as { boxes?: Array<{ name: string }> };
  return (body.boxes ?? [])
    .map((b) => new Uint8Array(Buffer.from(b.name, 'base64')))
    .filter(
      (n) =>
        n.length === FLIP_PREFIX.length + 32 &&
        Buffer.from(n.subarray(0, FLIP_PREFIX.length)).equals(FLIP_PREFIX),
    );
}

async function readBoxValue(appId: bigint, name: Uint8Array): Promise<Uint8Array | null> {
  const enc = encodeURIComponent(Buffer.from(name).toString('base64'));
  const res = await fetch(
    `${env.ALGOD_URL}/v2/applications/${appId.toString()}/box?name=b64:${enc}`,
    { headers: algodHeaders(), signal: AbortSignal.timeout(6000) },
  );
  if (res.status === 404) return null; // resolved/refunded between the list and this read
  if (!res.ok) throw new Error(`algod box read returned ${res.status}`);
  const body = (await res.json()) as { value: string };
  return new Uint8Array(Buffer.from(body.value, 'base64'));
}

/**
 * Locate the flip() txn that created this box, via the indexer. The contract computes
 * commit = ceil8(confirmed_round + 8), so the flip confirmed within [commit-16, commit].
 * In that window the only appl SENT BY the player to this app is the flip itself
 * (resolve comes from the keeper later; refund only after 48h). Null on indexer lag —
 * the bet row is then inserted without a txnId and recordBet adopts it later.
 */
export async function findFlipTxnId(
  appId: bigint,
  player: string,
  commitRound: bigint,
): Promise<string | null> {
  const minRound = commitRound > 16n ? commitRound - 16n : 0n;
  const url =
    `${env.INDEXER_URL}/v2/transactions?address=${player}&address-role=sender` +
    `&application-id=${appId.toString()}&tx-type=appl` +
    `&min-round=${minRound.toString()}&max-round=${commitRound.toString()}&limit=10`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const body = (await res.json()) as { transactions?: Array<{ id?: string; sender?: string }> };
  const txn = (body.transactions ?? []).find((t) => t.sender === player && t.id);
  return txn?.id ?? null;
}

/**
 * Register every orphaned flip box as a pending bet + session so the resolver settles it.
 * Returns the number of flips registered. Errors on individual boxes are logged and skipped —
 * one bad box must not starve the rest.
 */
export async function sweepOrphanFlips(
  logger: Logger,
  coinflipAppId: bigint,
  currentRound: bigint,
): Promise<number> {
  const names = await listFlipBoxNames(coinflipAppId);
  if (names.length === 0) return 0;

  let registered = 0;
  for (const name of names) {
    try {
      const value = await readBoxValue(coinflipAppId, name);
      if (!value) continue;
      const box = parseFlipBox(name, value);
      if (!box) continue;

      // Freshness guard: until the commit round has passed (~22s), the client is normally
      // still registering this flip itself; only sweep flips old enough to be suspicious.
      if (currentRound < box.vrfRound) continue;

      const [known] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.walletAddress, box.player), eq(sessions.commitRound, box.vrfRound)))
        .limit(1);
      if (known) continue;

      const txnId = await findFlipTxnId(coinflipAppId, box.player, box.vrfRound);

      // Mirror recordBet's insert. Atomic so a unique-index race (the client registering at
      // this exact moment) rolls back both rows; the client's path then owns the flip.
      await db.transaction(async (tx) => {
        const [b] = await tx
          .insert(bets)
          .values({
            walletAddress: box.player,
            gameId: 'coinflip',
            amountMicroalgo: box.betMicroalgo,
            vrfRound: box.vrfRound,
            saltHash: box.saltHashHex,
            playerPick: null, // unknown — the pick never touches the chain
            outcome: 'pending',
            txnId,
            referrerWallet: box.referrer,
            referralRakeBps: box.referrer ? 100 : null,
          })
          .returning();
        if (!b) throw new Error('orphan bet insert returned no row');
        await tx.insert(sessions).values({
          betId: b.id,
          walletAddress: box.player,
          gameId: 'coinflip',
          state: 'pending',
          commitRound: box.vrfRound,
          appId: coinflipAppId,
        });
      });

      registered += 1;
      logger.warn(
        {
          player: box.player,
          commitRound: box.vrfRound.toString(),
          betMicroalgo: box.betMicroalgo.toString(),
          txnId,
        },
        'orphan sweep: registered an on-chain flip the client never reported',
      );
    } catch (err) {
      logger.error({ err }, 'orphan sweep: failed to process a flip box');
    }
  }
  return registered;
}
