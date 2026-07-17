import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@fairground/db';
import { registerVerifiedBet, type RegisterVerifiedBetInput } from './register-bet.js';

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
});

const input: RegisterVerifiedBetInput = {
  txnId: 'A'.repeat(52),
  walletAddress: 'W'.repeat(58),
  gameId: 'coinflip',
  amountMicroalgo: 2_000_000n,
  vrfRound: 1_008n,
  saltHash: 'ab'.repeat(32),
  referrerWallet: null,
  confirmedRound: 1_000n,
  appId: 456n,
  paymentReceiver: 'CHAIN_APP_ADDRESS',
  playerPick: null,
};

const bet = {
  id: 'bet-1',
  walletAddress: input.walletAddress,
  gameId: input.gameId,
  amountMicroalgo: input.amountMicroalgo,
  vrfRound: input.vrfRound,
  vrfOutput: null,
  saltHash: input.saltHash,
  playerPick: null,
  outcome: 'pending',
  multiplier: null,
  netPayoutMicroalgo: null,
  referrerWallet: null,
  referralRakeBps: null,
  txnId: input.txnId,
  resolveTxnId: null,
  proofCardUrl: null,
  taps: 0,
  tapPoints: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  resolvedAt: null,
};

const session = {
  id: 'session-1',
  betId: bet.id,
  walletAddress: input.walletAddress,
  gameId: input.gameId,
  state: 'pending',
  commitRound: input.vrfRound,
  resolveRound: null,
  retryCount: 0,
  lastError: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  appId: input.appId,
};

function completedSelect(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

describe('registerVerifiedBet', () => {
  it('reuses the existing bet and session for the same chain txnId', async () => {
    const select = vi
      .fn()
      .mockImplementationOnce(() => completedSelect([bet]))
      .mockImplementationOnce(() => completedSelect([session]));
    const insert = vi.fn();
    const update = vi.fn();
    const tx = { select, insert, update };
    const database = {
      transaction: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as Database;

    const result = await registerVerifiedBet(database, input);

    expect(result).toEqual({
      betId: bet.id,
      sessionId: session.id,
      vrfRound: input.vrfRound,
      amountMicroalgo: input.amountMicroalgo,
      created: false,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
