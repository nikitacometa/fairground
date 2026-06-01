/**
 * AlgorandClient factory using @algorandfoundation/algokit-utils@9.2.0.
 *
 * algokit-utils 9.x exposes AlgorandClient as the primary entry point.
 * Reference: https://github.com/algorandfoundation/algokit-utils-ts
 */

import { AlgorandClient } from '@algorandfoundation/algokit-utils';

export interface FairgroundNetworkConfig {
  algodUrl: string;
  algodToken: string;
  indexerUrl: string;
  network: 'localnet' | 'testnet' | 'mainnet';
}

/**
 * Create an AlgorandClient from explicit network config.
 *
 * @example
 * const client = createAlgorandClient({
 *   algodUrl: 'https://mainnet-api.algonode.cloud',
 *   algodToken: '',
 *   indexerUrl: 'https://mainnet-idx.algonode.cloud',
 *   network: 'mainnet',
 * });
 */
export function createAlgorandClient(config: FairgroundNetworkConfig): AlgorandClient {
  return AlgorandClient.fromConfig({
    algodConfig: { server: config.algodUrl, token: config.algodToken },
    indexerConfig: { server: config.indexerUrl, token: '' },
  });
}

/**
 * Create an AlgorandClient from process.env.
 *
 * Reads ALGOD_URL, ALGOD_TOKEN, INDEXER_URL, ALGORAND_NETWORK.
 * Falls back to AlgoNode public endpoints for mainnet if not set.
 *
 * Used by packages/api and packages/keeper at startup after env validation.
 */
export function createAlgorandClientFromEnv(): AlgorandClient {
  const network = (process.env['ALGORAND_NETWORK'] ?? 'localnet') as
    | 'localnet'
    | 'testnet'
    | 'mainnet';

  const defaultAlgod =
    network === 'mainnet'
      ? 'https://mainnet-api.algonode.cloud'
      : network === 'testnet'
        ? 'https://testnet-api.algonode.cloud'
        : 'http://localhost:4001';

  const defaultIndexer =
    network === 'mainnet'
      ? 'https://mainnet-idx.algonode.cloud'
      : network === 'testnet'
        ? 'https://testnet-idx.algonode.cloud'
        : 'http://localhost:8980';

  return createAlgorandClient({
    algodUrl: process.env['ALGOD_URL'] ?? defaultAlgod,
    algodToken:
      process.env['ALGOD_TOKEN'] ??
      (network === 'localnet'
        ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        : ''),
    indexerUrl: process.env['INDEXER_URL'] ?? defaultIndexer,
    network,
  });
}
