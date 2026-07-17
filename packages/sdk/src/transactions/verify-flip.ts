import algosdk from 'algosdk';

const FLIP_METHOD = algosdk.ABIMethod.fromSignature('flip(pay,byte[32],address)uint64');
const FLIP_SELECTOR = FLIP_METHOD.getSelector();
const ARC4_RETURN_PREFIX = Uint8Array.from([0x15, 0x1f, 0x7c, 0x75]);

/** Coinflip FlipState box MBR: 2500 + 400 * (37-byte key + 80-byte value). */
export const COINFLIP_BOX_MBR_MICROALGO = 49_300n;

export type FlipVerificationCode =
  | 'transaction_not_found'
  | 'transaction_unconfirmed'
  | 'transaction_id_mismatch'
  | 'invalid_flip_app_call'
  | 'sender_mismatch'
  | 'application_mismatch'
  | 'salt_mismatch'
  | 'round_mismatch'
  | 'referrer_mismatch'
  | 'invalid_atomic_group'
  | 'payment_not_found'
  | 'receiver_mismatch'
  | 'amount_mismatch'
  | 'chain_unavailable';

export class FlipTransactionVerificationError extends Error {
  constructor(
    readonly code: FlipVerificationCode,
    message: string,
  ) {
    super(message);
    this.name = 'FlipTransactionVerificationError';
  }
}

export interface IndexedFlipTransaction {
  id?: string;
  txType?: string;
  sender: string;
  confirmedRound?: bigint;
  intraRoundOffset?: number;
  group?: Uint8Array;
  logs?: Uint8Array[];
  applicationTransaction?: {
    applicationId: bigint;
    applicationArgs?: Uint8Array[];
    onCompletion?: string;
  };
  paymentTransaction?: {
    amount: bigint;
    receiver: string;
  };
}

/** Small lookup seam so indexer access is deterministic and mockable in unit tests. */
export interface FlipTransactionLookup {
  lookupById(txnId: string): Promise<IndexedFlipTransaction | null>;
  lookupGroup(groupId: Uint8Array): Promise<IndexedFlipTransaction[]>;
}

export interface FlipTransactionClaims {
  txnId: string;
  walletAddress: string;
  amountMicroalgo: bigint;
  vrfRound: bigint;
  saltHash: string;
  referrerWallet: string | null;
}

export interface VerifiedFlipTransaction {
  txnId: string;
  walletAddress: string;
  amountMicroalgo: bigint;
  vrfRound: bigint;
  saltHash: string;
  referrerWallet: string | null;
  confirmedRound: bigint;
  appId: bigint;
  paymentReceiver: string;
}

function bytesEqual(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function decodeArc4Uint64Return(logs: Uint8Array[] | undefined): bigint | null {
  const returnLog = [...(logs ?? [])]
    .reverse()
    .find((log) => log.length === 12 && bytesEqual(log.subarray(0, 4), ARC4_RETURN_PREFIX));
  if (!returnLog) return null;
  let value = 0n;
  for (const byte of returnLog.subarray(4)) value = (value << 8n) | BigInt(byte);
  return value;
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function fail(code: FlipVerificationCode, message: string): never {
  throw new FlipTransactionVerificationError(code, message);
}

/**
 * Verify a client-supplied flip transaction against the indexer's confirmed chain data.
 * The txnId identifies the app call; the stake is the preceding payment in its atomic group.
 */
export async function verifyFlipTransaction(
  lookup: FlipTransactionLookup,
  coinflipAppId: bigint,
  claims: FlipTransactionClaims,
): Promise<VerifiedFlipTransaction> {
  let appCall: IndexedFlipTransaction | null;
  try {
    appCall = await lookup.lookupById(claims.txnId);
  } catch {
    fail('chain_unavailable', 'indexer transaction lookup failed');
  }
  if (!appCall) fail('transaction_not_found', 'transaction was not found by the indexer');
  if (appCall.id !== claims.txnId) fail('transaction_id_mismatch', 'indexer returned another txid');
  if (!appCall.confirmedRound || appCall.confirmedRound <= 0n) {
    fail('transaction_unconfirmed', 'transaction is not confirmed');
  }
  if (appCall.txType !== 'appl' || !appCall.applicationTransaction) {
    fail('invalid_flip_app_call', 'transaction is not an application call');
  }
  if (appCall.sender !== claims.walletAddress) {
    fail('sender_mismatch', 'application-call sender does not match wallet');
  }
  if (appCall.applicationTransaction.applicationId !== coinflipAppId) {
    fail('application_mismatch', 'application call targets another contract');
  }
  if (
    appCall.applicationTransaction.onCompletion !== undefined &&
    appCall.applicationTransaction.onCompletion !== 'noop'
  ) {
    fail('invalid_flip_app_call', 'flip application call is not NoOp');
  }

  const args = appCall.applicationTransaction.applicationArgs ?? [];
  if (args.length !== 3 || !bytesEqual(args[0], FLIP_SELECTOR)) {
    fail('invalid_flip_app_call', 'application call is not flip(pay,byte[32],address)uint64');
  }
  const chainSalt = args[1];
  if (!chainSalt || chainSalt.length !== 32 || hex(chainSalt) !== claims.saltHash.toLowerCase()) {
    fail('salt_mismatch', 'flip salt hash does not match request');
  }
  const referrerArg = args[2];
  if (!referrerArg || referrerArg.length !== 32) {
    fail('invalid_flip_app_call', 'flip referrer argument is malformed');
  }
  const referrerAddress = algosdk.encodeAddress(referrerArg);
  const chainReferrer =
    referrerAddress === algosdk.ALGORAND_ZERO_ADDRESS_STRING ? null : referrerAddress;
  if (chainReferrer !== claims.referrerWallet) {
    fail('referrer_mismatch', 'flip referrer does not match request');
  }

  const chainVrfRound = decodeArc4Uint64Return(appCall.logs);
  const derivedVrfRound = ((appCall.confirmedRound + 8n + 7n) / 8n) * 8n;
  if (
    chainVrfRound === null ||
    chainVrfRound !== derivedVrfRound ||
    chainVrfRound !== claims.vrfRound
  ) {
    fail('round_mismatch', 'flip ARC-4 return round does not match request');
  }
  if (!appCall.group) fail('invalid_atomic_group', 'flip app call has no atomic group');

  let group: IndexedFlipTransaction[];
  try {
    group = await lookup.lookupGroup(appCall.group);
  } catch {
    fail('chain_unavailable', 'indexer transaction-group lookup failed');
  }
  if (group.length !== 2) fail('invalid_atomic_group', 'flip group must contain two transactions');
  const payment = group.find((txn) => txn.txType === 'pay' && txn.paymentTransaction);
  const groupedAppCall = group.find((txn) => txn.id === claims.txnId);
  if (!payment?.paymentTransaction) fail('payment_not_found', 'flip payment was not found');
  if (!groupedAppCall) fail('invalid_atomic_group', 'looked-up app call is absent from its group');
  if (
    payment.confirmedRound !== appCall.confirmedRound ||
    groupedAppCall.confirmedRound !== appCall.confirmedRound ||
    !bytesEqual(payment.group, appCall.group) ||
    !bytesEqual(groupedAppCall.group, appCall.group)
  ) {
    fail('invalid_atomic_group', 'flip group is not confirmed in one round');
  }
  if (
    payment.intraRoundOffset === undefined ||
    groupedAppCall.intraRoundOffset === undefined ||
    payment.intraRoundOffset + 1 !== groupedAppCall.intraRoundOffset
  ) {
    fail('invalid_atomic_group', 'flip payment must immediately precede the app call');
  }
  if (payment.sender !== appCall.sender) {
    fail('sender_mismatch', 'payment sender does not match application-call sender');
  }

  const expectedReceiver = algosdk.getApplicationAddress(coinflipAppId).toString();
  if (payment.paymentTransaction.receiver !== expectedReceiver) {
    fail('receiver_mismatch', 'payment receiver is not the coinflip application');
  }
  if (payment.paymentTransaction.amount <= COINFLIP_BOX_MBR_MICROALGO) {
    fail('amount_mismatch', 'payment does not cover the box MBR');
  }
  const chainAmount = payment.paymentTransaction.amount - COINFLIP_BOX_MBR_MICROALGO;
  if (chainAmount !== claims.amountMicroalgo) {
    fail('amount_mismatch', 'on-chain stake does not match request');
  }

  return {
    txnId: appCall.id,
    walletAddress: appCall.sender,
    amountMicroalgo: chainAmount,
    vrfRound: chainVrfRound,
    saltHash: hex(chainSalt),
    referrerWallet: chainReferrer,
    confirmedRound: appCall.confirmedRound,
    appId: appCall.applicationTransaction.applicationId,
    paymentReceiver: payment.paymentTransaction.receiver,
  };
}

function isIndexerNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { status?: unknown; response?: { status?: unknown } };
  return value.status === 404 || value.response?.status === 404;
}

function fromIndexerTransaction(txn: algosdk.indexerModels.Transaction): IndexedFlipTransaction {
  return {
    id: txn.id,
    txType: txn.txType,
    sender: txn.sender,
    confirmedRound: txn.confirmedRound,
    intraRoundOffset: txn.intraRoundOffset,
    group: txn.group,
    logs: txn.logs,
    applicationTransaction: txn.applicationTransaction
      ? {
          applicationId: txn.applicationTransaction.applicationId,
          applicationArgs: txn.applicationTransaction.applicationArgs,
          onCompletion: txn.applicationTransaction.onCompletion,
        }
      : undefined,
    paymentTransaction: txn.paymentTransaction
      ? {
          amount: txn.paymentTransaction.amount,
          receiver: txn.paymentTransaction.receiver,
        }
      : undefined,
  };
}

/** Adapt the shared algosdk Indexer client to the verifier's mockable lookup seam. */
export function createIndexerFlipTransactionLookup(
  indexer: algosdk.Indexer,
): FlipTransactionLookup {
  return {
    async lookupById(txnId) {
      try {
        const response = await indexer.lookupTransactionByID(txnId).do();
        return fromIndexerTransaction(response.transaction);
      } catch (error) {
        if (isIndexerNotFound(error)) return null;
        throw error;
      }
    },
    async lookupGroup(groupId) {
      const response = await indexer.searchForTransactions().groupid(groupId).limit(16).do();
      return (response.transactions ?? []).map(fromIndexerTransaction);
    },
  };
}
