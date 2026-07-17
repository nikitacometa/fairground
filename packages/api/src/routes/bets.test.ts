import pino from 'pino';
import { vi, describe, expect, it } from 'vitest';
import type { FlipTransactionClaims, VerifiedFlipTransaction } from '@fairground/sdk';
import type { RegisterVerifiedBetInput } from '../lib/register-bet.js';
import { makeBetsRouter } from './bets.js';

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    HOUSE_TREASURY_APP_ID: '123',
    COINFLIP_APP_ID: '456',
  });
});

const TXN_ID = 'A'.repeat(52);
const WALLET = 'W'.repeat(58);
const SALT = 'ab'.repeat(32);
const verified: VerifiedFlipTransaction = {
  txnId: TXN_ID,
  walletAddress: WALLET,
  amountMicroalgo: 2_000_000n,
  vrfRound: 1_008n,
  saltHash: SALT,
  referrerWallet: null,
  confirmedRound: 1_000n,
  appId: 456n,
  paymentReceiver: 'APP_ADDRESS_FROM_CHAIN',
};

const logger = pino({ enabled: false });

function requestBody(): string {
  return JSON.stringify({
    walletAddress: WALLET,
    txnId: TXN_ID,
    vrfRound: '1008',
    saltHash: SALT,
    amountMicroalgo: '2000000',
    playerPick: 'heads',
    referrerWallet: null,
  });
}

describe('POST /:gameId/bets', () => {
  it('passes only normalized chain identity into persistence', async () => {
    const verifyFlip = vi.fn((_claims: FlipTransactionClaims) => Promise.resolve(verified));
    const registerBet = vi.fn((input: RegisterVerifiedBetInput) =>
      Promise.resolve({
        betId: 'bet-1',
        sessionId: 'session-1',
        vrfRound: input.vrfRound,
        amountMicroalgo: input.amountMicroalgo,
        created: true,
      }),
    );
    const app = makeBetsRouter(logger, { verifyFlip, registerBet });

    const response = await app.request('/coinflip/bets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody(),
    });

    expect(response.status).toBe(200);
    expect(registerBet).toHaveBeenCalledWith({
      ...verified,
      gameId: 'coinflip',
      playerPick: null,
    });
  });

  it('rejects a missing transaction before persistence', async () => {
    const { FlipTransactionVerificationError } = await import('@fairground/sdk');
    const verifyFlip = vi.fn(() =>
      Promise.reject(new FlipTransactionVerificationError('transaction_not_found', 'not found')),
    );
    const registerBet = vi.fn();
    const app = makeBetsRouter(logger, { verifyFlip, registerBet });

    const response = await app.request('/coinflip/bets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody(),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'transaction_not_found',
      code: 'chain_verification_error',
    });
    expect(registerBet).not.toHaveBeenCalled();
  });

  it('returns the same identity on a repeated POST without creating another row', async () => {
    const verifyFlip = vi.fn(() => Promise.resolve(verified));
    let created = false;
    let insertCount = 0;
    const registerBet = vi.fn((_input: RegisterVerifiedBetInput) => {
      const result = {
        betId: 'bet-1',
        sessionId: 'session-1',
        vrfRound: verified.vrfRound,
        amountMicroalgo: verified.amountMicroalgo,
        created: !created,
      };
      if (!created) insertCount += 1;
      created = true;
      return Promise.resolve(result);
    });
    const app = makeBetsRouter(logger, { verifyFlip, registerBet });
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody(),
    };

    const first = await app.request('/coinflip/bets', init);
    const second = await app.request('/coinflip/bets', init);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      data: { betId: 'bet-1', sessionId: 'session-1' },
    });
    expect(registerBet).toHaveBeenCalledTimes(2);
    expect(insertCount).toBe(1);
  });
});
