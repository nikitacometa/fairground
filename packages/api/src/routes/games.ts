/**
 * Game routes.
 *
 * POST /games/:gameId/bets
 *   Validates the incoming bet request, builds the unsigned transaction group
 *   via @fairground/sdk, persists a pending bet+session record, and returns
 *   the base64-encoded unsigned group for the client to sign and submit.
 *
 *   The client signs + submits the group themselves (Pera / Defly / etc.) and
 *   then polls GET /games/:gameId/state/:sessionId. The keeper handles resolve().
 *
 * GET /games/:gameId/state/:sessionId
 *   Returns the current session state (pending / resolving / resolved / refunded).
 *   bigint fields are serialized as strings per the project convention.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod/v4';
import { eq } from 'drizzle-orm';
import type { FairgroundDb, SessionRow } from '@fairground/db';
import { bets, sessions } from '@fairground/db';
import {
  GameIdSchema,
  type ApiResult,
  toBigintString,
} from '@fairground/types';
import { createAlgorandClient } from '@fairground/sdk';
import type { ApiEnv } from '@fairground/types';

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

const PlaceBetBodySchema = z.object({
  walletAddress: z.string().min(58).max(58),
  // amountMicroalgo sent as string by the client (avoids JS bigint JSON issues).
  amountMicroalgo: z.string().regex(/^\d+$/, 'must be a decimal integer string'),
  // sha256 of the player's secret salt, hex-encoded (64 hex chars = 32 bytes).
  saltHash: z.string().length(64).regex(/^[0-9a-f]+$/i),
  // Optional referrer wallet address (zero address = none).
  referrerWallet: z.string().min(58).max(58).optional(),
});

type PlaceBetBody = z.infer<typeof PlaceBetBodySchema>;

interface PlaceBetResponse {
  sessionId: string;
  betId: string;
  commitRound: string;
  vrfRound: string;
  // Base64-encoded msgpack of the unsigned transaction group.
  // Client decodes, signs with their wallet, and submits to algod.
  unsignedGroupBase64: string;
}

interface SessionStateResponse {
  sessionId: string;
  betId: string;
  walletAddress: string;
  gameId: string;
  state: SessionRow['state'];
  commitRound: string;
  resolveRound: string | null;
  retryCount: number;
  lastError: string | null;
  // Only populated after resolution:
  outcome: string | null;
  netPayoutMicroalgo: string | null;
  proofCardUrl: string | null;
  txnId: string | null;
  resolveTxnId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Route factory — receives db + env so the module stays pure (testable).
// ---------------------------------------------------------------------------

export function buildGamesRouter(db: FairgroundDb, env: ApiEnv): Hono {
  const router = new Hono();
  const algo = createAlgorandClient({
    algodUrl: env.ALGOD_URL,
    algodToken: env.ALGOD_TOKEN,
    indexerUrl: env.INDEXER_URL,
    network: env.ALGORAND_NETWORK,
  });

  // -------------------------------------------------------------------------
  // POST /games/:gameId/bets
  // -------------------------------------------------------------------------
  router.post(
    '/:gameId/bets',
    zValidator('param', z.object({ gameId: GameIdSchema })),
    zValidator('json', PlaceBetBodySchema),
    async (c): Promise<Response> => {
      const { gameId } = c.req.valid('param');
      const body: PlaceBetBody = c.req.valid('json');

      const amountMicroalgo = BigInt(body.amountMicroalgo);

      // Soft-cap validation (contract enforces the hard cap on-chain).
      if (amountMicroalgo < env.MIN_BET_MICROALGO) {
        return c.json<ApiResult<never>>(
          {
            ok: false,
            error: `Bet below minimum: ${toBigintString(env.MIN_BET_MICROALGO)} microALGO`,
            code: 'BET_TOO_SMALL',
          },
          400,
        );
      }
      if (amountMicroalgo > env.MAX_BET_MICROALGO) {
        return c.json<ApiResult<never>>(
          {
            ok: false,
            error: `Bet above maximum: ${toBigintString(env.MAX_BET_MICROALGO)} microALGO`,
            code: 'BET_TOO_LARGE',
          },
          400,
        );
      }

      if (gameId !== 'coinflip') {
        // Only coinflip is live in v1.
        return c.json<ApiResult<never>>(
          { ok: false, error: `Game ${gameId} is not yet live.`, code: 'GAME_NOT_LIVE' },
          404,
        );
      }

      // Fetch current network round to compute the VRF commit round.
      // TODO: replace with cached round (avoids a round-trip on every bet).
      // algosdk 3.x: NodeStatusResponse uses camelCase `lastRound` (bigint).
      // algo.client.algod: algokit-utils 9.x accessor — `any` until package is installed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const algodClient = (algo as any).client.algod as import('algosdk').Algodv2;
      const nodeStatus = await algodClient.status().do();
      const currentRound = nodeStatus.lastRound;
      // Contract uses current_round + BEACON_DELAY (8). Mirror that here.
      const vrfRound = currentRound + 8n;

      // Build the unsigned flip() transaction group.
      // TODO: replace with generated CoinflipContractClient.compose().flip() once
      //   pnpm contracts:generate has run. Until then we build the group manually
      //   using raw algosdk (see packages/sdk/src/clients/README.md).
      //
      // The group is a 2-txn atomic group:
      //   Txn 0: Payment(receiver=coinflipAppAddr, amount=amountMicroalgo + BOX_MBR)
      //   Txn 1: AppCall(coinflipAppId, flip, saltHash, referrer)
      //
      // The client (browser wallet) signs the group and submits it. The API only
      // builds the unsigned group so it never touches the player's keys.
      const algosdk = await import('algosdk');
      const params = await algodClient.getTransactionParams().do();

      const coinflipAppId = Number(env.COINFLIP_APP_ID);
      const coinflipAppAddr = algosdk.getApplicationAddress(coinflipAppId);

      // BOX_MBR = 36_900 microALGO — must match contract constant.
      const BOX_MBR = 36_900n;
      const paymentAmount = amountMicroalgo + BOX_MBR;

      const saltHashBytes = Buffer.from(body.saltHash, 'hex');
      const referrerAddr = body.referrerWallet ?? algosdk.ALGORAND_ZERO_ADDRESS_STRING;

      // ABI method selector for flip(byte[32],address)uint64
      // sha512_256("flip(byte[32],address)uint64")[:4]
      // TODO: derive from CoinflipContractClient ABI JSON once generated.
      // For now: precomputed as 0x8b87bc05 (verify against compiled artifact).
      const FLIP_SELECTOR = Buffer.from([0x8b, 0x87, 0xbc, 0x05]);

      // ARC4-encode salt_hash as static byte[32]: no length prefix, just raw 32 bytes.
      const saltHashArg = saltHashBytes; // 32 raw bytes

      // ARC4-encode referrer as address: 32-byte public key.
      const referrerPk = algosdk.decodeAddress(referrerAddr).publicKey;

      const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: body.walletAddress,
        receiver: coinflipAppAddr,
        amount: Number(paymentAmount),
        suggestedParams: { ...params, fee: 1000, flatFee: true },
      });

      const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: body.walletAddress,
        appIndex: coinflipAppId,
        appArgs: [FLIP_SELECTOR, saltHashArg, referrerPk],
        foreignApps: [Number(env.HOUSE_TREASURY_APP_ID), Number(env.VRF_BEACON_APP_ID)],
        suggestedParams: { ...params, fee: 2000, flatFee: true },
      });

      algosdk.assignGroupID([payTxn, appCallTxn]);

      // encodeUnsignedTransaction returns Uint8Array; Buffer.from converts for base64.
      const unsignedGroup =
        Buffer.from(algosdk.encodeUnsignedTransaction(payTxn)).toString('base64') +
        ',' +
        Buffer.from(algosdk.encodeUnsignedTransaction(appCallTxn)).toString('base64');

      // Persist the pending bet and session records in a single DB transaction.
      // The bet row is the authoritative record; the session row drives the keeper.
      const saltHashHex = body.saltHash.toLowerCase();

      let betId: string;
      let sessionId: string;

      await db.transaction(async (tx) => {
        const [betRow] = await tx
          .insert(bets)
          .values({
            walletAddress: body.walletAddress,
            gameId,
            amountMicroalgo,
            vrfRound,
            saltHash: saltHashHex,
            outcome: 'pending',
            referrerWallet: body.referrerWallet ?? null,
          })
          .returning({ id: bets.id });

        if (!betRow) throw new Error('Failed to insert bet row');
        betId = betRow.id;

        const [sessionRow] = await tx
          .insert(sessions)
          .values({
            betId,
            walletAddress: body.walletAddress,
            gameId,
            state: 'pending',
            commitRound: vrfRound,
          })
          .returning({ id: sessions.id });

        if (!sessionRow) throw new Error('Failed to insert session row');
        sessionId = sessionRow.id;
      });

      const resp: PlaceBetResponse = {
        sessionId: sessionId!,
        betId: betId!,
        commitRound: toBigintString(vrfRound),
        vrfRound: toBigintString(vrfRound),
        unsignedGroupBase64: unsignedGroup,
      };

      return c.json<ApiResult<PlaceBetResponse>>({ ok: true, data: resp }, 201);
    },
  );

  // -------------------------------------------------------------------------
  // GET /games/:gameId/state/:sessionId
  // -------------------------------------------------------------------------
  router.get(
    '/:gameId/state/:sessionId',
    zValidator(
      'param',
      z.object({ gameId: GameIdSchema, sessionId: z.string().uuid() }),
    ),
    async (c): Promise<Response> => {
      const { gameId, sessionId } = c.req.valid('param');

      // Join sessions → bets to get outcome + payout without a second round-trip.
      const rows = await db
        .select({
          sessionId: sessions.id,
          betId: sessions.betId,
          walletAddress: sessions.walletAddress,
          gameId: sessions.gameId,
          state: sessions.state,
          commitRound: sessions.commitRound,
          resolveRound: sessions.resolveRound,
          retryCount: sessions.retryCount,
          lastError: sessions.lastError,
          createdAt: sessions.createdAt,
          updatedAt: sessions.updatedAt,
          outcome: bets.outcome,
          netPayoutMicroalgo: bets.netPayoutMicroalgo,
          proofCardUrl: bets.proofCardUrl,
          txnId: bets.txnId,
          resolveTxnId: bets.resolveTxnId,
        })
        .from(sessions)
        .innerJoin(bets, eq(bets.id, sessions.betId))
        .where(eq(sessions.id, sessionId))
        .limit(1);

      const row = rows[0];

      if (!row || row.gameId !== gameId) {
        return c.json<ApiResult<never>>(
          { ok: false, error: 'Session not found', code: 'NOT_FOUND' },
          404,
        );
      }

      const resp: SessionStateResponse = {
        sessionId: row.sessionId,
        betId: row.betId,
        walletAddress: row.walletAddress,
        gameId: row.gameId,
        state: row.state,
        commitRound: toBigintString(row.commitRound),
        resolveRound: row.resolveRound != null ? toBigintString(row.resolveRound) : null,
        retryCount: row.retryCount,
        lastError: row.lastError ?? null,
        outcome: row.outcome ?? null,
        netPayoutMicroalgo:
          row.netPayoutMicroalgo != null ? toBigintString(row.netPayoutMicroalgo) : null,
        proofCardUrl: row.proofCardUrl ?? null,
        txnId: row.txnId ?? null,
        resolveTxnId: row.resolveTxnId ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      return c.json<ApiResult<SessionStateResponse>>({ ok: true, data: resp });
    },
  );

  return router;
}
