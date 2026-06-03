import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const GAME = process.env['GAME_URL'] ?? 'https://app.fairground.quest';

/** Collect React hydration / runtime errors. A hydration mismatch (React #418) surfaces here. */
function trackHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  const isHydration = (t: string): boolean =>
    /Minified React error #41[0-9]|hydrat|did not match|Text content does not match/i.test(t);
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && isHydration(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (isHydration(String(e))) errors.push(String(e));
  });
  return errors;
}

/** Wait for the primary flip button to be ready, then click it. */
async function startFlip(page: Page): Promise<void> {
  const flip = page.locator('.fg-btn-primary');
  await expect(flip).toBeVisible();
  await expect(flip).toBeEnabled();
  await flip.click();
}

test.describe('game dApp', () => {
  test('idle loads, shows the coinflip panel, and hydrates without a React mismatch', async ({
    page,
  }) => {
    const hydrationErrors = trackHydrationErrors(page);
    await page.goto(GAME);
    await expect(page.getByText('COINFLIP', { exact: false })).toBeVisible();
    await expect(page.locator('.fg-btn-primary')).toBeVisible();
    await page.waitForTimeout(2500); // let wallet resume + async chunks settle
    expect(hydrationErrors, `hydration errors:\n${hydrationErrors.join('\n')}`).toEqual([]);
  });

  test('demo WIN flow: flip → VRF wait → win reveal → payout + play-again', async ({ page }) => {
    await page.goto(`${GAME}/?demo=win`);
    await startFlip(page);
    await expect(page.getByText(/You Won/i)).toBeVisible({ timeout: 30_000 });
    // Demo has no real proof card (no on-chain bet), so assert the payout + the replay CTA,
    // which both render in the wallet-free walkthrough.
    await expect(page.getByText(/ALGO/i).first()).toBeVisible();
    await expect(page.getByText(/Play Again/i)).toBeVisible();
  });

  test('demo LOSS flow: flip → loss reveal with deadpan copy + accept-result CTA', async ({
    page,
  }) => {
    await page.goto(`${GAME}/?demo=loss`);
    await startFlip(page);
    await expect(page.getByText(/You Lost/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/sha-256 was correct\. you were not\./i)).toBeVisible();
    await expect(page.getByText(/Accept result/i)).toBeVisible();
  });

  test('leaderboard page renders (table or empty state) without errors', async ({ page }) => {
    const hydrationErrors = trackHydrationErrors(page);
    await page.goto(`${GAME}/leaderboard`);
    await expect(page.getByRole('heading', { name: /Leaderboard/i })).toBeVisible();
    expect(hydrationErrors).toEqual([]);
  });
});
