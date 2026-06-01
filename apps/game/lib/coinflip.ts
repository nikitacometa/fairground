/**
 * Client-side coinflip transaction builder.
 *
 * Per the project convention (CLAUDE.md): the generated ARC-56 client is the ONLY
 * interface between app code and the contracts — no raw algosdk group construction.
 * The browser builds, signs (via the connected wallet), and submits the flip group
 * directly to algod; the API only RECORDS the confirmed bet afterwards (see lib/api.ts).
 *
 * The flip group is [payment(bet + BOX_MBR) -> contract, app call flip(pay, salt_hash,
 * referrer)]. The app call returns the committed VRF round (current_round + 8), which we
 * read from the ABI return and hand to the keeper via the record endpoint.
 */

import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import type { TransactionSigner } from 'algosdk';
import algosdk from 'algosdk';
import {
  CoinflipContractClient,
  createAlgorandClient,
  type FairgroundNetworkConfig,
} from '@fairground/sdk';

// Zero address = "no referrer". Computed from 32 zero bytes to avoid depending on a
// specific algosdk constant name across versions.
const ZERO_ADDRESS = algosdk.encodeAddress(new Uint8Array(32));

export type SupportedNetwork = 'testnet' | 'mainnet';

function resolveNetwork(raw: string | undefined): FairgroundNetworkConfig {
  if (raw === 'mainnet') {
    return {
      algodUrl: 'https://mainnet-api.algonode.cloud',
      algodToken: '',
      indexerUrl: 'https://mainnet-idx.algonode.cloud',
      network: 'mainnet',
    };
  }
  // Default to testnet for anything else (localnet is not reachable from a browser).
  return {
    algodUrl: 'https://testnet-api.algonode.cloud',
    algodToken: '',
    indexerUrl: 'https://testnet-idx.algonode.cloud',
    network: 'testnet',
  };
}

export interface SendFlipParams {
  network: string | undefined;
  coinflipAppId: bigint;
  sender: string;
  signer: TransactionSigner;
  /** Bet amount in microALGO, exclusive of the box MBR. */
  betMicroalgo: bigint;
  /** Box minimum-balance deposit added to the payment (returned to the player on resolve). */
  boxMbr: bigint;
  /** 32-byte SHA-256 hash of the client-side salt preimage. */
  saltHash: Uint8Array;
  /** Optional referral wallet; omit/null for no referrer. */
  referrer?: string | null;
}

export interface SendFlipResult {
  /** Committed VRF beacon round (current_round + 8). */
  commitRound: bigint;
  /** The flip app-call transaction ID — recorded and shown on the proof card. */
  txnId: string;
}

/**
 * Build, sign, and submit a flip group. Resolves once the group is confirmed on-chain.
 * Throws if the wallet rejects signing, the contract rejects the call, or the ABI return
 * is missing.
 */
export async function sendFlip(params: SendFlipParams): Promise<SendFlipResult> {
  const algorand = createAlgorandClient(resolveNetwork(params.network));
  algorand.setDefaultSigner(params.signer);
  // Wallet approval (Pera QR / WalletConnect) can take well over the ~10-round (~28s)
  // default window. Build with a wide window so a slow human approval does not produce a
  // dead transaction by the time it is signed and submitted.
  algorand.setDefaultValidityWindow(1000);

  const client = new CoinflipContractClient({
    algorand,
    appId: params.coinflipAppId,
    defaultSender: params.sender,
    defaultSigner: params.signer,
  });

  // Payment must equal bet + BOX_MBR and be sent by the player to the contract.
  const pay = await algorand.createTransaction.payment({
    sender: params.sender,
    receiver: client.appAddress,
    amount: AlgoAmount.MicroAlgos(params.betMicroalgo + params.boxMbr),
  });

  const result = await client.send.flip({
    args: {
      pay,
      saltHash: params.saltHash,
      referrer: params.referrer ?? ZERO_ADDRESS,
    },
    // The flip box (flip:<address>) does not exist until this call creates it; let
    // algokit-utils discover and attach the box reference via simulate.
    populateAppCallResources: true,
  });

  if (result.return === undefined) {
    throw new Error('flip succeeded but returned no commit round');
  }

  return {
    commitRound: result.return,
    txnId: result.transaction.txID(),
  };
}
