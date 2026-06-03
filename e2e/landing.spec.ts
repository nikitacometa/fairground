import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const LANDING = process.env['LANDING_URL'] ?? 'https://fairground.quest';

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

test.describe('landing', () => {
  test('hero + all sections render and hydrate cleanly', async ({ page }) => {
    const hydrationErrors = trackHydrationErrors(page);
    await page.goto(LANDING);

    await expect(page.getByRole('heading', { name: /Provably Fair/i })).toBeVisible();
    await expect(page.getByText(/Play Coinflip/i)).toBeVisible();

    // client:visible / data-reveal islands hydrate on scroll — walk the page.
    for (const heading of [
      'How It Works',
      'How a Coin Flip Moves the Economy',
      'Terms of Fairness',
      'VRF Proof Card',
    ]) {
      const el = page.getByRole('heading', { name: new RegExp(heading, 'i') });
      await el.scrollIntoViewIfNeeded();
      await expect(el).toBeVisible();
    }

    // the ironic dossier copy is the brand's signature screenshot-bait
    await expect(page.getByText(/Neither charm, persuasion, nor prayer/i)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(hydrationErrors, `hydration errors:\n${hydrationErrors.join('\n')}`).toEqual([]);
  });
});
