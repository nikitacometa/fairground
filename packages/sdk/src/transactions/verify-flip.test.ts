import algosdk from 'algosdk';
import { describe, expect, it, vi } from 'vitest';
import {
  COINFLIP_BOX_MBR_MICROALGO,
  FlipTransactionVerificationError,
  verifyFlipTransaction,
  type FlipTransactionLookup,
  type IndexedFlipTransaction,
} from './verify-flip.js';

const APP_ID = 1_234n;
const TXN_ID = 'A'.repeat(52);
const WALLET = algosdk.encodeAddress(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const GROUP = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const SALT = Uint8Array.from({ length: 32 }, (_, i) => i);
const SALT_HEX = Buffer.from(SALT).toString('hex');
const CONFIRMED_ROUND = 1_000n;
const VRF_ROUND = 1_008n;
const AMOUNT = 2_000_000n;

function uint64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value);
  return bytes;
}

function fixture(overrides: Partial<IndexedFlipTransaction> = {}): {
  appCall: IndexedFlipTransaction;
  payment: IndexedFlipTransaction;
} {
  const appCall: IndexedFlipTransaction = {
    id: TXN_ID,
    txType: 'appl',
    sender: WALLET,
    confirmedRound: CONFIRMED_ROUND,
    intraRoundOffset: 11,
    group: GROUP,
    logs: [Uint8Array.from([0x15, 0x1f, 0x7c, 0x75, ...uint64(VRF_ROUND)])],
    applicationTransaction: {
      applicationId: APP_ID,
      applicationArgs: [
        algosdk.ABIMethod.fromSignature('flip(pay,byte[32],address)uint64').getSelector(),
        SALT,
        new Uint8Array(32),
      ],
      onCompletion: 'noop',
    },
    ...overrides,
  };
  const payment: IndexedFlipTransaction = {
    id: 'B'.repeat(52),
    txType: 'pay',
    sender: WALLET,
    confirmedRound: CONFIRMED_ROUND,
    intraRoundOffset: 10,
    group: GROUP,
    paymentTransaction: {
      amount: AMOUNT + COINFLIP_BOX_MBR_MICROALGO,
      receiver: algosdk.getApplicationAddress(APP_ID).toString(),
    },
  };
  return { appCall, payment };
}

function lookup(
  appCall: IndexedFlipTransaction | null,
  group: IndexedFlipTransaction[],
): FlipTransactionLookup {
  return {
    lookupById: vi.fn(() => Promise.resolve(appCall)),
    lookupGroup: vi.fn(() => Promise.resolve(group)),
  };
}

const claims = {
  txnId: TXN_ID,
  walletAddress: WALLET,
  amountMicroalgo: AMOUNT,
  vrfRound: VRF_ROUND,
  saltHash: SALT_HEX,
  referrerWallet: null,
};

describe('verifyFlipTransaction', () => {
  it('returns normalized values from the confirmed app-call and payment group', async () => {
    const { appCall, payment } = fixture();

    await expect(
      verifyFlipTransaction(lookup(appCall, [payment, appCall]), APP_ID, claims),
    ).resolves.toMatchObject({
      txnId: TXN_ID,
      walletAddress: WALLET,
      amountMicroalgo: AMOUNT,
      vrfRound: VRF_ROUND,
      saltHash: SALT_HEX,
      appId: APP_ID,
      confirmedRound: CONFIRMED_ROUND,
    });
  });

  it('rejects an unknown txnId', async () => {
    await expect(verifyFlipTransaction(lookup(null, []), APP_ID, claims)).rejects.toMatchObject({
      code: 'transaction_not_found',
    } satisfies Partial<FlipTransactionVerificationError>);
  });

  it('returns a typed upstream error when the indexer lookup fails', async () => {
    const unavailable: FlipTransactionLookup = {
      lookupById: vi.fn(() => Promise.reject(new Error('indexer unavailable'))),
      lookupGroup: vi.fn(() => Promise.resolve([])),
    };

    await expect(verifyFlipTransaction(unavailable, APP_ID, claims)).rejects.toMatchObject({
      code: 'chain_unavailable',
    });
  });

  it('rejects a forged amount', async () => {
    const { appCall, payment } = fixture();

    await expect(
      verifyFlipTransaction(lookup(appCall, [payment, appCall]), APP_ID, {
        ...claims,
        amountMicroalgo: AMOUNT + 1n,
      }),
    ).rejects.toMatchObject({ code: 'amount_mismatch' });
  });

  it('rejects a payment sent to another receiver', async () => {
    const { appCall, payment } = fixture();
    if (!payment.paymentTransaction) throw new Error('fixture payment is missing');
    payment.paymentTransaction.receiver = WALLET;

    await expect(
      verifyFlipTransaction(lookup(appCall, [payment, appCall]), APP_ID, claims),
    ).rejects.toMatchObject({ code: 'receiver_mismatch' });
  });

  it('rejects a round that disagrees with the confirmed-round formula', async () => {
    const { appCall, payment } = fixture({ confirmedRound: 1_001n });
    payment.confirmedRound = 1_001n;

    await expect(
      verifyFlipTransaction(lookup(appCall, [payment, appCall]), APP_ID, claims),
    ).rejects.toMatchObject({ code: 'round_mismatch' });
  });
});
