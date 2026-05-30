import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/sdk/vitest.config.ts',
  'packages/types/vitest.config.ts',
  'packages/db/vitest.config.ts',
  'packages/api/vitest.config.ts',
  'packages/keeper/vitest.config.ts',
  'packages/proof-card/vitest.config.ts',
  'packages/price-client/vitest.config.ts',
  'apps/game/vitest.config.ts',
]);
