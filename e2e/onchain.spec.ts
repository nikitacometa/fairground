import { test, expect } from '@playwright/test';

/**
 * Tier 4 — full on-chain flow with programmatic signing (no human wallet tap).
 *
 * This is the answer to "Playwright can't sign Pera/Defly": the game, built with
 * NEXT_PUBLIC_E2E=1, enables use-wallet's Mnemonic wallet. We connect it, satisfy its
 * mnemonic prompt from E2E_MNEMONIC, and drive a REAL flip end to end (commit → VRF wait →
 * keeper resolve → payout → proof card) — all without a device.
 *
 * Requirements (see docs/testing.md):
 *   - an E2E build/deploy on TestNet (NEXT_PUBLIC_E2E=1, contracts + keeper on TestNet)
 *   - a TestNet-funded test account mnemonic in E2E_MNEMONIC
 *   - run with:  E2E_ONCHAIN=1 GAME_URL=<e2e-build-url> E2E_MNEMONIC="word word ..." pnpm test:e2e
 *
 * Skipped unless E2E_ONCHAIN=1 so the default suite stays fast and infra-free.
 */
const ONCHAIN = process.env['E2E_ONCHAIN'] === '1';
const GAME = process.env['GAME_URL'] ?? 'http://localhost:3000';
const MNEMONIC = process.env['E2E_MNEMONIC'] ?? '';

test.describe('on-chain flip (mnemonic wallet, programmatic signing)', () => {
  test.skip(!ONCHAIN, 'set E2E_ONCHAIN=1 (needs a TestNet e2e build + funded E2E_MNEMONIC)');

  test('connect mnemonic wallet → real flip → resolves on-chain', async ({ page }) => {
    expect(MNEMONIC, 'E2E_MNEMONIC must be set').not.toEqual('');

    // The Mnemonic wallet asks for the phrase via window.prompt — answer it automatically.
    page.on('dialog', (d) => void d.accept(MNEMONIC));

    await page.goto(GAME);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await page.getByRole('button', { name: /Mnemonic/i }).click();

    // Wallet connected → flip. The Mnemonic wallet signs without a device prompt.
    await page.locator('.fg-btn-primary').click();

    // VRF wait (~30s commit floor) + keeper resolve. Generous timeout for TestNet round time.
    await expect(page.getByText(/You Won|You Lost/i)).toBeVisible({ timeout: 90_000 });
    // a resolved flip always exposes a verifiable transaction link
    await expect(page.getByText(/Verify|allo\.info|Proof/i).first()).toBeVisible();
  });
});
