# @fairground/price-client

Vestige price batching queue with circuit breaker. Ported from `cometa/metafarm-frontend/src/providers/coinPriceProvider.ts`.

No dependencies — uses the native `fetch` API (Node 22+).

## Features

- 250ms debounce before flushing accumulated requests
- 25-asset chunks per Vestige API request
- Groups requests by `denominatingAssetId` (USDC vs ALGO denominated)
- Circuit breaker: 5 consecutive failures → 30s cooldown, auto partial-reset

## Usage

```ts
import { getAlgoPrice, getAssetPrice } from '@fairground/price-client';

// ALGO/USD
const algoUsd = await getAlgoPrice(); // number | null

// Asset price in USD
const metaUsd = await getAssetPrice(397589378); // number | null

// Asset price in ALGO
const metaAlgo = await getAssetAlgoPrice(397589378); // number | null
```

## Circuit Breaker

```ts
import { getCircuitBreakerState, resetCircuitBreaker } from '@fairground/price-client';

const state = getCircuitBreakerState();
// { failures: 0, openUntil: 0, isOpen: false }

resetCircuitBreaker(); // for tests
```
