#!/usr/bin/env node
/**
 * CLI: npx tsx src/cli.ts --txnId <txnId> --outcome heads|tails --vrfRound 12345 --output ./proof.png
 */
import { writeFileSync } from 'node:fs';
import { generateProofCard } from './index.js';
import type { ProofCardData } from '@fairground/types';

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const txnId = getArg('--txnId') ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const outcomeRaw = getArg('--outcome') ?? 'heads';
const vrfRoundRaw = getArg('--vrfRound') ?? '12345678';
const output = getArg('--output') ?? './proof-card.png';
const wallet = getArg('--wallet') ?? 'TESTWAL1';

if (!['heads', 'tails', 'jackpot'].includes(outcomeRaw)) {
  console.error('--outcome must be heads, tails, or jackpot');
  process.exit(1);
}

const data: ProofCardData = {
  game: 'coinflip',
  walletPrefix: wallet.slice(0, 8),
  outcome: outcomeRaw as 'heads' | 'tails' | 'jackpot',
  multiplier: outcomeRaw === 'heads' ? 1.96 : 0,
  vrfRound: BigInt(vrfRoundRaw),
  beaconOutputHash: 'a'.repeat(64),
  txnId,
  netPayoutMicroalgo: outcomeRaw === 'heads' ? 980_000n : 0n,
  timestamp: new Date(),
};

generateProofCard(data)
  .then((buf) => {
    writeFileSync(output, buf);
    console.log(`Proof card written to ${output}`);
  })
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
