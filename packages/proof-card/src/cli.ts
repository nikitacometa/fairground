#!/usr/bin/env tsx
/**
 * CLI for generating a proof card PNG from JSON input.
 *
 * Usage:
 *   echo '{...ProofCardData}' | npx tsx src/cli.ts > card.png
 *   npx tsx src/cli.ts --sample > sample.png
 *
 * bigint fields (vrfRound, netPayoutMicroalgo) accept a numeric string in JSON
 * and are coerced; --sample emits a fixed example card.
 */

import { generateProofCard } from './index.js';
import type { ProofCardData } from '@fairground/types';

const SAMPLE: ProofCardData = {
  game: 'coinflip',
  walletPrefix: 'COOKHRI3',
  outcome: 'heads',
  multiplier: 1.96,
  vrfRound: 12_345_678n,
  beaconOutputHash: 'a'.repeat(64),
  txnId: 'X'.repeat(52),
  netPayoutMicroalgo: 980_000n,
  timestamp: new Date(),
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseData(raw: string): ProofCardData {
  const obj = JSON.parse(raw) as Record<string, unknown>;
  return {
    ...obj,
    vrfRound: BigInt(obj['vrfRound'] as string | number),
    netPayoutMicroalgo: BigInt(obj['netPayoutMicroalgo'] as string | number),
    timestamp: new Date(obj['timestamp'] as string),
  } as ProofCardData;
}

async function main(): Promise<void> {
  const useSample = process.argv.includes('--sample');
  const data = useSample ? SAMPLE : parseData(await readStdin());
  const png = await generateProofCard(data, { variant: 'landscape' });
  process.stdout.write(png);
}

main().catch((err) => {
  console.error('proof-card cli failed:', err);
  process.exit(1);
});
