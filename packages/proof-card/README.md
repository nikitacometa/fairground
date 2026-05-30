# @fairground/proof-card

Shareable VRF result proof card PNG generator. Ported from `beef-web/src/cards/` pipeline.

## Pipeline

```
ProofCardData  →  VrfResultCard (React JSX)  →  satori 0.26 (SVG)  →  @resvg/resvg-js (PNG)  →  sharp (border frame)
```

## Formats

| Format | Dimensions | Use |
|---|---|---|
| `landscape` | 1600×900 | Twitter/X card preview |
| `square` | 1200×1200 | Instagram / generic share |

## Usage

```ts
import { renderProofCard } from '@fairground/proof-card';

const png = await renderProofCard({
  game: 'coinflip',
  walletPrefix: 'ABC12345',
  outcome: 'heads',
  multiplier: 1.96,
  vrfRound: 36970600n,
  beaconOutputHash: 'a1b2c3d4...',
  txnId: 'ABCDEFGH...',
  netPayoutMicroalgo: 980000n,
  timestamp: new Date(),
}, { format: 'landscape' });
```

## CLI

```bash
npx tsx src/cli.ts \
  --data '{"game":"coinflip","walletPrefix":"ABC12345","outcome":"heads","multiplier":1.96,"vrfRound":"36970600","beaconOutputHash":"a1b2...","txnId":"ABCD...","netPayoutMicroalgo":"980000","timestamp":"2026-05-31T12:00:00Z"}' \
  --format landscape \
  --output result.png
```

## Fonts

Place font files in `assets/fonts/` before first use:
- `IBMPlexMono-Regular.ttf`
- `IBMPlexMono-SemiBold.ttf`
- `IBMPlexMono-Bold.ttf`

Source: [IBM Plex](https://github.com/IBM/plex/releases) (OFL license).
