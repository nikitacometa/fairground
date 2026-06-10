/**
 * FairJackpot daily-pot keeper tick.
 *
 * Called from the main keeper loop once per minute (module-level rate gate).
 * Does nothing when JACKPOT_APP_ID=0 (jackpot disabled).
 *
 * The 7 steps mirror the on-chain epoch lifecycle:
 *   1. Read global state
 *   2. Backstop top-up (Redis NX guard, 10-min window)
 *   3. Commit draw when epoch closes
 *   4. Resolve pending draw (recommit check → beacon → hints → submit)
 *   5. Record: parse DrawResolved ARC-28 event, upsert draws row
 *   6. Snapshot + announce: read player accumulator boxes, insert draw_tickets, publish Redis event
 *   7. Cleanup: batch-delete ticket boxes to reclaim MBR
 */

import { createHash } from 'node:crypto';
import algosdk from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { db, draws, drawTickets } from '@fairground/db';
import { FairJackpotClient, createAlgorandClientFromEnv } from '@fairground/sdk';
import { REDIS_CHANNEL_DRAW_RESOLVED } from '@fairground/types';
import type { DrawResolvedEvent } from '@fairground/types';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { readGlobalState, itob8 } from './algod-utils.js';
import { env } from './env.js';

// ─── module-level rate gate (no second setInterval) ────────────────────────

let lastJackpotCheckAt = 0;

// ─── helpers ───────────────────────────────────────────────────────────────

function decodeUint64BE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/**
 * Read an application box via raw algod REST.
 * Returns the box value bytes, or null when the box does not exist (404).
 * Throws on any other HTTP or network error.
 */
async function readBox(
  algodUrl: string,
  algodToken: string,
  appId: bigint,
  nameBytes: Uint8Array,
): Promise<Uint8Array | null> {
  const b64Name = Buffer.from(nameBytes).toString('base64');
  const headers: Record<string, string> = algodToken ? { 'X-Algo-API-Token': algodToken } : {};
  const url = `${algodUrl}/v2/applications/${appId.toString()}/box?name=b64:${encodeURIComponent(b64Name)}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`algod GET box for app ${appId.toString()} returned ${res.status}`);
  const body = (await res.json()) as { value: string };
  return new Uint8Array(Buffer.from(body.value, 'base64'));
}

/** Compute the 4-byte ARC-28 event selector (sha512-256 of the signature). */
function eventSelector(sig: string): Uint8Array {
  return new Uint8Array(createHash('sha512-256').update(sig).digest().slice(0, 4));
}

interface ParsedDrawResolved {
  epoch: bigint;
  pot: bigint;
  rollover: bigint;
  totalTickets: bigint;
  commitRound: bigint;
  vrfOutputHex: string;
  /** Address bytes (32-byte public key) per slot */
  winnerPks: Uint8Array[];
  payouts: bigint[];
}

/** Parse a DrawResolved ARC-28 event from the confirmation log list of a group. */
function parseDrawResolvedEvent(
  confirmations: algosdk.modelsv2.PendingTransactionResponse[],
): ParsedDrawResolved | null {
  const sig = 'DrawResolved(uint64,uint64,uint64,uint64,uint64,byte[32],address[],uint64[])';
  const sel = eventSelector(sig);
  const abiType = algosdk.ABIType.from(
    '(uint64,uint64,uint64,uint64,uint64,byte[32],address[],uint64[])',
  );

  for (const conf of confirmations) {
    for (const log of conf.logs ?? []) {
      if (log.length < 4) continue;
      if (!sel.every((b, i) => b === log[i])) continue;
      const decoded = abiType.decode(log.slice(4)) as unknown[];
      return {
        epoch: decoded[0] as bigint,
        pot: decoded[1] as bigint,
        rollover: decoded[2] as bigint,
        totalTickets: decoded[3] as bigint,
        commitRound: decoded[4] as bigint,
        vrfOutputHex: Buffer.from(decoded[5] as Uint8Array).toString('hex'),
        winnerPks: decoded[6] as Uint8Array[],
        payouts: decoded[7] as bigint[],
      };
    }
  }
  return null;
}

// ─── main export ───────────────────────────────────────────────────────────

/**
 * Run one jackpot maintenance tick.
 *
 * Rate-limited to once per 60 seconds via `lastJackpotCheckAt`.
 * Does nothing and returns immediately when `JACKPOT_APP_ID === 0n`.
 */
export async function runJackpotTick(
  algodClient: algosdk.Algodv2,
  redis: Redis,
  logger: Logger,
  keeperMnemonic: string,
): Promise<void> {
  // Gate 1: jackpot disabled
  if (env.JACKPOT_APP_ID === 0n) return;

  // Gate 2: 60-second rate limit (no second setInterval needed)
  const now = Date.now();
  if (now - lastJackpotCheckAt < 60_000) return;
  lastJackpotCheckAt = now;

  // ── Step 1: read global state ──────────────────────────────────────────
  const state = await readGlobalState(env.ALGOD_URL, env.ALGOD_TOKEN, env.JACKPOT_APP_ID);

  const paused = (state.get('paused') ?? 0n) !== 0n;
  const potBalance = state.get('pot_balance') ?? 0n;
  const backstopMicroalgo = state.get('backstop_microalgo') ?? 0n;
  const epochId = state.get('epoch_id') ?? 0n;
  const epochCloseTsSec = state.get('epoch_close_ts') ?? 0n;
  const pendingEpoch = state.get('pending_epoch') ?? 0n;
  const pendingCommitRound = state.get('pending_commit_round') ?? 0n;
  const pendingTotalTickets = state.get('pending_total_tickets') ?? 0n;
  const pendingEntryCount = state.get('pending_entry_count') ?? 0n;
  const pendingRunnerCount = state.get('pending_runner_count') ?? 0n;
  // Use beacon app id recorded in the jackpot contract's own state (survives beacon migration).
  const beaconAppId = state.get('beacon_app_id') ?? env.VRF_BEACON_APP_ID;

  logger.debug(
    {
      jackpotAppId: env.JACKPOT_APP_ID.toString(),
      paused,
      potBalance: potBalance.toString(),
      epochId: epochId.toString(),
      pendingEpoch: pendingEpoch.toString(),
    },
    'jackpot tick',
  );

  // Build keeper account once, reuse below.
  const account = algosdk.mnemonicToSecretKey(keeperMnemonic);
  const signer = algosdk.makeBasicAccountTransactionSigner(account);

  const algorand = createAlgorandClientFromEnv();
  algorand.setDefaultSigner(signer);

  const client = new FairJackpotClient({
    algorand,
    appId: env.JACKPOT_APP_ID,
    defaultSender: account.addr.toString(),
  });

  // ── Step 2: BACKSTOP top-up ─────────────────────────────────────────────
  // Only when the pot is below the backstop, no pending draw is active, and
  // we haven't topped up within the last 10 minutes (Redis NX guard).
  if (!paused && pendingEpoch === 0n && backstopMicroalgo > 0n && potBalance < backstopMicroalgo) {
    const redisKey = `jackpot:backstop:${env.JACKPOT_APP_ID.toString()}`;
    const acquired = await redis.set(redisKey, '1', 'EX', 600, 'NX');
    if (acquired === 'OK') {
      // Top up to backstop + 0.1 ALGO buffer so we don't immediately re-trigger.
      const topUpAmount = backstopMicroalgo - potBalance + 100_000n;
      const jackpotAppAddr = algosdk.getApplicationAddress(env.JACKPOT_APP_ID).toString();
      const suggestedParams = await algodClient.getTransactionParams().do();
      const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: account.addr.toString(),
        receiver: jackpotAppAddr,
        amount: Number(topUpAmount),
        suggestedParams,
      });
      await client.send.depositPot({
        args: { pay: { txn: payTxn, signer } },
      });
      logger.info(
        { topUpAmount: topUpAmount.toString(), jackpotAppId: env.JACKPOT_APP_ID.toString() },
        'jackpot backstop top-up sent',
      );
    }
  }

  // ── Step 3: COMMIT ──────────────────────────────────────────────────────
  // Only when the epoch has elapsed AND there is no draw already pending.
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (!paused && pendingEpoch === 0n && epochCloseTsSec > 0n && nowSec >= epochCloseTsSec) {
    await client.send.commitDraw({
      args: {},
      appReferences: [beaconAppId],
      // outer (1) + inner beacon app call (1) = 2000 µA total fee
      extraFee: AlgoAmount.MicroAlgos(2000),
    });
    logger.info(
      { epochId: epochId.toString(), jackpotAppId: env.JACKPOT_APP_ID.toString() },
      'jackpot draw committed',
    );
    // Nothing more to do this tick; resolve happens next tick after BEACON_SETTLE_BUFFER.
    return;
  }

  // ── Step 4: RESOLVE (only when a pending draw exists) ───────────────────
  if (pendingEpoch === 0n) return;

  const statusResult = await algodClient.status().do();
  const currentRound = statusResult.lastRound;

  // 4a. Recommit check: if the commit round is too old for the beacon (~70 min window),
  // the contract's recommit_draw() shifts the commit to a fresh VRF round.
  // RECOMMIT_AFTER_ROUNDS matches the constant on the contract side.
  const RECOMMIT_AFTER_ROUNDS = 1000n;
  if (pendingCommitRound > 0n && currentRound > pendingCommitRound + RECOMMIT_AFTER_ROUNDS) {
    try {
      await client.send.recommitDraw({
        args: {},
        appReferences: [beaconAppId],
        extraFee: AlgoAmount.MicroAlgos(2000),
      });
      logger.info(
        { pendingEpoch: pendingEpoch.toString(), oldCommitRound: pendingCommitRound.toString() },
        'jackpot draw recommitted to fresh VRF round',
      );
    } catch (err) {
      // Contract reverts "draw is still resolvable" if the round hasn't expired on-chain yet.
      // Not an error: the keeper's threshold and the contract's threshold may differ slightly.
      logger.warn(
        { err, pendingEpoch: pendingEpoch.toString() },
        'recommitDraw reverted -- draw may still be within on-chain window',
      );
    }
    // Either way, don't try to resolve in this tick: the (new) commit round needs BEACON_SETTLE_BUFFER.
    return;
  }

  // 4b. Settle buffer: beacon needs BEACON_SETTLE_BUFFER rounds after the commit round.
  const BEACON_SETTLE_BUFFER = 4n;
  if (currentRound < pendingCommitRound + BEACON_SETTLE_BUFFER) return;

  // 4c. Beacon simulation: check if the VRF output is available for pendingCommitRound.
  const beaconMethod = new algosdk.ABIMethod({
    name: 'get',
    args: [
      { type: 'uint64', name: 'round' },
      { type: 'byte[]', name: 'user_data' },
    ],
    returns: { type: 'byte[]' },
  });
  const atc = new algosdk.AtomicTransactionComposer();
  const suggestedParams = await algodClient.getTransactionParams().do();
  atc.addMethodCall({
    appID: Number(beaconAppId),
    method: beaconMethod,
    methodArgs: [pendingCommitRound, new Uint8Array(0)],
    suggestedParams,
    sender: account.addr.toString(),
    signer,
  });
  const simReq = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowUnnamedResources: true,
  });
  const simResult = await atc.simulate(algodClient, simReq);
  const vrfRaw = simResult.methodResults[0]?.returnValue;
  if (!(vrfRaw instanceof Uint8Array) || vrfRaw.length !== 32) {
    logger.debug(
      { pendingCommitRound: pendingCommitRound.toString(), currentRound: currentRound.toString() },
      'jackpot beacon output not yet available',
    );
    return;
  }
  const vrfOutput: Uint8Array = vrfRaw;

  // 4d. Read all ledger page boxes for the pending epoch.
  // Each page: 102 entries × 40 bytes (32 pk + 8 cumAfter).
  interface LedgerEntry {
    playerPk: Uint8Array;
    cumAfter: bigint;
  }
  const allEntries: LedgerEntry[] = [];
  const totalPages = pendingEntryCount > 0n ? (pendingEntryCount + 101n) / 102n : 0n;
  for (let page = 0n; page < totalPages; page++) {
    const pageKey = Buffer.concat([
      Buffer.from('p'),
      Buffer.from(itob8(pendingEpoch)),
      Buffer.from(itob8(page)),
    ]);
    const pageData = await readBox(env.ALGOD_URL, env.ALGOD_TOKEN, env.JACKPOT_APP_ID, pageKey);
    if (!pageData || pageData.length === 0) break;
    // A page box is allocated full (102 × 40 zero bytes); only the first
    // (pendingEntryCount - page*102) slots on the LAST page are real. Reading the
    // zeroed tail (cumAfter = 0) corrupts the ascending invariant the binary search
    // relies on, producing an out-of-range hint the contract rejects.
    const realOnThisPage = Number(pendingEntryCount - page * 102n);
    const entryCount = Math.min(102, realOnThisPage);
    for (let e = 0; e < entryCount; e++) {
      const playerPk = pageData.slice(e * 40, e * 40 + 32);
      const cumAfterBytes = pageData.slice(e * 40 + 32, e * 40 + 40);
      allEntries.push({ playerPk, cumAfter: decodeUint64BE(cumAfterBytes) });
    }
  }

  if (allEntries.length === 0 || pendingTotalTickets === 0n) {
    logger.warn(
      { pendingEpoch: pendingEpoch.toString(), totalPages: totalPages.toString() },
      'jackpot no entries in ledger pages -- skipping resolve',
    );
    return;
  }

  // 4e. Compute winner hints.
  // hint[i] = global entry index whose ticket range contains target ticket i.
  // target[i] = sha256(vrfOutput || itob8(i)) % pendingTotalTickets
  // Binary search: find smallest j where allEntries[j].cumAfter > target
  const numSlots = 1n + pendingRunnerCount; // 1 winner + N runners
  const hints: bigint[] = [];
  for (let i = 0n; i < numSlots; i++) {
    const hash = createHash('sha256')
      .update(Buffer.concat([Buffer.from(vrfOutput), Buffer.from(itob8(i))]))
      .digest();
    // Contract: winning_ticket = btoi(sha256(...)[0:8]) % total. btoi reads exactly
    // the FIRST 8 bytes as a uint64 -- not the full 32-byte digest. Hashing the whole
    // thing as a 256-bit int then taking the modulo yields a different value and every
    // hint reverts. Match the AVM byte-for-byte.
    const target = decodeUint64BE(hash.subarray(0, 8)) % pendingTotalTickets;

    let lo = 0;
    let hi = allEntries.length - 1;
    let found = allEntries.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const entry = allEntries[mid];
      if (entry !== undefined && entry.cumAfter > target) {
        found = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    hints.push(BigInt(found));
  }

  // 4f. Collect unique page box refs needed for resolve_draw.
  // resolve_draw reads each hint's own page (cumAfter[hint], upper bound) AND, for
  // hint > 0, the entry hint-1 (cumAfter[hint-1], lower bound) which lives on the
  // PREVIOUS page when hint sits on a page boundary (hint % 102 === 0). Omitting
  // that previous page makes the on-chain box_extract panic with 'invalid box
  // reference' for any winner whose ticket lands at a page boundary.
  const pageSet = new Set<bigint>();
  for (const h of hints) {
    pageSet.add(h / 102n);
    if (h > 0n) pageSet.add((h - 1n) / 102n);
  }
  const hintPageNums = Array.from(pageSet);
  const pageBoxRefs = hintPageNums.map((page) => ({
    appId: env.JACKPOT_APP_ID,
    name: Buffer.concat([
      Buffer.from('p'),
      Buffer.from(itob8(pendingEpoch)),
      Buffer.from(itob8(page)),
    ]),
  }));

  // First 8 refs go into resolve_draw, overflow into noop carriers (each carrying up to 8 more).
  const firstBatch = pageBoxRefs.slice(0, 8);
  const overflowRefs = pageBoxRefs.slice(8);
  const noopBatches: (typeof pageBoxRefs)[] = [];
  for (let i = 0; i < overflowRefs.length; i += 8) {
    noopBatches.push(overflowRefs.slice(i, i + 8));
  }

  // 4g. Submit the resolve group.
  // staticFee 15000 µA: covers 14 inner transactions (beacon get + winner/runner payments).
  const composer = client.newGroup();
  composer.resolveDraw({
    args: { hints },
    boxReferences: firstBatch,
    appReferences: [beaconAppId],
    staticFee: AlgoAmount.MicroAlgos(15000),
  });
  for (let i = 0; i < noopBatches.length; i++) {
    composer.noop({
      args: { i: BigInt(i + 1) },
      boxReferences: noopBatches[i] ?? [],
      staticFee: AlgoAmount.MicroAlgos(1000),
    });
  }
  const resolveResult = await composer.send();
  const resolveTxnId = resolveResult.txIds[0] ?? '';

  logger.info(
    { pendingEpoch: pendingEpoch.toString(), txnId: resolveTxnId },
    'jackpot resolve_draw submitted',
  );

  // ── Step 5: RECORD ──────────────────────────────────────────────────────
  const drawEvent = parseDrawResolvedEvent(resolveResult.confirmations ?? []);
  if (!drawEvent) {
    logger.error(
      { pendingEpoch: pendingEpoch.toString(), txnId: resolveTxnId },
      'DrawResolved ARC-28 event not found in confirmation logs -- draw result not recorded',
    );
    return;
  }

  const winnerAddress =
    drawEvent.winnerPks[0] !== undefined ? algosdk.encodeAddress(drawEvent.winnerPks[0]) : null;
  const winnerPayout = drawEvent.payouts[0] ?? 0n;

  const runnersUp = drawEvent.winnerPks.slice(1).map((pk, idx) => ({
    address: algosdk.encodeAddress(pk),
    nfd: null as string | null,
    payoutMicroalgo: (drawEvent.payouts[idx + 1] ?? 0n).toString(),
  }));

  const [drawRow] = await db
    .insert(draws)
    .values({
      epochId: drawEvent.epoch,
      state: 'resolved',
      potMicroalgo: drawEvent.pot,
      rolloverMicroalgo: drawEvent.rollover,
      totalTickets: drawEvent.totalTickets,
      commitRound: drawEvent.commitRound,
      vrfRound: pendingCommitRound,
      beaconOutput: drawEvent.vrfOutputHex,
      winnerAddress,
      winnerPayoutMicroalgo: winnerPayout,
      runnersUp,
      resolveTxnId,
      drawnAt: new Date(),
    })
    .onConflictDoUpdate({
      target: draws.epochId,
      set: {
        state: 'resolved',
        potMicroalgo: drawEvent.pot,
        rolloverMicroalgo: drawEvent.rollover,
        totalTickets: drawEvent.totalTickets,
        commitRound: drawEvent.commitRound,
        vrfRound: pendingCommitRound,
        beaconOutput: drawEvent.vrfOutputHex,
        winnerAddress,
        winnerPayoutMicroalgo: winnerPayout,
        runnersUp,
        resolveTxnId,
        drawnAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({ id: draws.id });

  const drawId = drawRow?.id;
  if (!drawId) {
    logger.error(
      { epochId: drawEvent.epoch.toString() },
      'failed to upsert draws row -- aborting post-resolve steps',
    );
    return;
  }

  // ── Step 6: SNAPSHOT + PROOF + ANNOUNCE ────────────────────────────────

  // 6a. Read player accumulator boxes to build the draw_tickets snapshot.
  // The accumulator box "t" + epoch(8) + pk(32) stores the player's total ticket count.
  const uniquePlayers = new Map<string, Uint8Array>();
  for (const entry of allEntries) {
    const addr = algosdk.encodeAddress(entry.playerPk);
    if (!uniquePlayers.has(addr)) uniquePlayers.set(addr, entry.playerPk);
  }

  for (const [addr, pk] of uniquePlayers) {
    const accKey = Buffer.concat([
      Buffer.from('t'),
      Buffer.from(itob8(pendingEpoch)),
      Buffer.from(pk),
    ]);
    const accData = await readBox(env.ALGOD_URL, env.ALGOD_TOKEN, env.JACKPOT_APP_ID, accKey);
    // Accumulator box layout: wagered(8) + tickets_issued(8). A box that exists with
    // only the wagered field written (AccrueSkipped: MBR exhausted, no tickets) is
    // < 16 bytes-meaningful -- treat as 0 tickets rather than mis-reading wagered as
    // tickets.
    const wageredMicroalgo =
      accData && accData.length >= 16 ? decodeUint64BE(accData.slice(0, 8)) : 0n;
    const tickets = accData && accData.length >= 16 ? decodeUint64BE(accData.slice(8, 16)) : 0n;

    await db
      .insert(drawTickets)
      .values({
        drawId,
        epochId: drawEvent.epoch,
        walletAddress: addr,
        tickets,
        wageredMicroalgo,
      })
      .onConflictDoNothing();
  }

  // 6b. Proof card URL: the API generates the PNG lazily at GET /proof/draw/:epochId.
  //     @fairground/proof-card is intentionally NOT imported here (not in keeper's package.json
  //     to avoid pnpm-lock.yaml changes). The stored URL is sufficient for the API to generate
  //     the card on first request.
  const proofCardUrl = `/proof/draw/${drawEvent.epoch.toString()}`;

  await db
    .update(draws)
    .set({ state: 'recorded', proofCardUrl, updatedAt: new Date() })
    .where(eq(draws.id, drawId));

  // 6c. Redis pub/sub: fan out to all WebSocket-connected clients.
  await redis.publish(
    REDIS_CHANNEL_DRAW_RESOLVED,
    JSON.stringify({
      type: 'draw:resolved',
      epochId: drawEvent.epoch.toString(),
      potMicroalgo: drawEvent.pot.toString(),
      winnerAddress: winnerAddress ?? '',
      winnerPayoutMicroalgo: winnerPayout.toString(),
      proofUrl: proofCardUrl,
    } satisfies DrawResolvedEvent),
  );

  logger.info(
    {
      epochId: drawEvent.epoch.toString(),
      winner: winnerAddress,
      payout: winnerPayout.toString(),
      txnId: resolveTxnId,
    },
    'jackpot draw recorded and announced',
  );

  // ── Step 7: CLEANUP ─────────────────────────────────────────────────────
  // Batch-delete ticket boxes of the resolved epoch to reclaim MBR.
  // Batch size: ≤6 players + ≤2 pages per call (box ref budget within 8).
  const allAddresses = Array.from(uniquePlayers.keys());
  const pageNumbers: bigint[] = [];
  for (let p = 0n; p < totalPages; p++) pageNumbers.push(p);

  const PLAYERS_PER_CLEANUP = 6;
  const PAGES_PER_CLEANUP = 2;

  const pageQueue = [...pageNumbers];
  let playerOffset = 0;

  while (playerOffset < allAddresses.length || pageQueue.length > 0) {
    const playerBatch = allAddresses.slice(playerOffset, playerOffset + PLAYERS_PER_CLEANUP);
    const pageBatch = pageQueue.splice(0, PAGES_PER_CLEANUP);
    playerOffset += PLAYERS_PER_CLEANUP;

    if (playerBatch.length === 0 && pageBatch.length === 0) break;

    // Build the box refs list so the contract can locate and delete the boxes.
    const cleanupBoxRefs: Array<{ appId: bigint; name: Uint8Array }> = [];
    for (const addr of playerBatch) {
      const pk = uniquePlayers.get(addr);
      if (!pk) continue;
      cleanupBoxRefs.push({
        appId: env.JACKPOT_APP_ID,
        name: Buffer.concat([
          Buffer.from('t'),
          Buffer.from(itob8(drawEvent.epoch)),
          Buffer.from(pk),
        ]),
      });
    }
    for (const p of pageBatch) {
      cleanupBoxRefs.push({
        appId: env.JACKPOT_APP_ID,
        name: Buffer.concat([
          Buffer.from('p'),
          Buffer.from(itob8(drawEvent.epoch)),
          Buffer.from(itob8(p)),
        ]),
      });
    }

    try {
      await client.send.cleanup({
        args: {
          epoch: drawEvent.epoch,
          players: playerBatch,
          pages: pageBatch,
        },
        boxReferences: cleanupBoxRefs,
        extraFee: AlgoAmount.MicroAlgos(1000),
      });
    } catch (err) {
      // Cleanup failure is non-fatal: MBR is locked but funds and game data are unaffected.
      // Missing boxes are skipped by the contract (no revert on races).
      logger.warn(
        {
          err,
          epochId: drawEvent.epoch.toString(),
          playerBatchSize: playerBatch.length,
          pageBatchSize: pageBatch.length,
        },
        'jackpot cleanup batch failed -- continuing (MBR reclaim deferred)',
      );
    }
  }

  logger.info({ epochId: drawEvent.epoch.toString() }, 'jackpot cleanup complete');
}
