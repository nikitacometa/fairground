import { defineConfig, devices } from '@playwright/test';

/**
 * Fairground end-to-end suite (Tier 3 + Tier 4 of docs/testing.md).
 *
 * Targets are configurable so the same specs run against production or a local server:
 *   GAME_URL     (default https://app.fairground.quest)
 *   LANDING_URL  (default https://fairground.quest)
 *
 * One-time setup:  pnpm exec playwright install chromium
 * Run:             pnpm test:e2e            (or  GAME_URL=http://localhost:3000 pnpm test:e2e)
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  // One retry everywhere: these specs hit a live deployment with real animations/timing, so a
  // transient miss should not fail the run.
  retries: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
