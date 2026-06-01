# Fairground Proof-Card Share Intent

Every resolved flip has a VRF proof card PNG at `https://api.fairground.xyz/proof/:txnId` (satori → resvg → sharp; cached permanently in Redis as `proof:{txnId}`). The card — VRF round, beacon-output hash, tx ID — is the shareable artifact and the marketing budget. The share button opens a pre-filled tweet whose card preview the proof URL renders.

## Share-intent URL builder

```typescript
export function buildShareIntent(p: {
  txnId: string;
  outcome: 'win' | 'loss';
  pick: 'heads' | 'tails';
  betAmountAlgo: number;
  payoutAlgo: number;
  vrfRound: bigint;
}): string {
  const text =
    p.outcome === 'win'
      ? `Flipped ${p.pick} and won ${p.payoutAlgo} ALGO on Fairground — VRF round #${p.vrfRound}, provably fair on Algorand. 🤝`
      : `Flipped ${p.pick} on Fairground — VRF round #${p.vrfRound}. Provably fair, win or lose.`;
  const proofUrl = `https://api.fairground.xyz/proof/${p.txnId}`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(proofUrl)}`;
}
```

## Rules

- The proof endpoint **must be publicly reachable before the first public game** — Twitter's card crawler hits it at tweet time (Open Question #8). Deploy the API before any launch tweet.
- Render the actual **player pick** and outcome — the scaffold hardcodes "Heads — You Won"; the UI must compare the contract outcome against the player's pick (which must be sent to the server; the scaffold never sends it).
- Link the on-chain tx to a **maintained** explorer: `allo.info/tx/{txnId}` or `explorer.perawallet.app/tx/{txnId}`. **Never `algoexplorer.io`** — shut down 2024 (still present in `CoinflipGame.tsx`, `VrfResultCard.tsx`).
- The share modal opens after `resolve()` settles. Include: proof-card image, the tweet button, and a direct "verify on-chain" link to the tx.
- A refunded bet has **no VRF result** → no proof card (the API returns 409 `no_proof_for_outcome`). Don't show a share button for refunds.
- Hashtags: `#Algorand #ProvablyFair`. Never describe the product as "gambling" in copy that could reach Foundation channels.
