import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Reduced motion keeps the map still, so the test does not depend on a GPU.
test.use({ reducedMotion: 'reduce' });

test('search finds a train home, highlights it, and makes a card', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(page.locator('#status')).toContainText('reduced motion');

  await page.fill('#from', 'Bangalore');
  await page.fill('#to', 'Patna');
  await page.click('#find');
  await expect(page.locator('#result-title')).toHaveText('Bengaluru → Patna', { timeout: 30_000 });
  await expect(page.locator('#from')).toHaveValue('Bengaluru, Karnataka');
  await expect(page.locator('.steps li').first()).toContainText('→');
  await expect(page.locator('.fares li').first()).toContainText('₹');
  await expect(page.locator('#legend')).toContainText('Your train in gold');
  expect(page.url()).toContain('to=Patna');

  await page.click('#make-card');
  await expect(page.locator('#card-download')).toBeVisible();
  await expect(page.locator('#card-canvas')).toHaveAttribute('aria-label', /Bengaluru → Patna/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#make-card')).toBeFocused();
  expect(errors).toEqual([]);
});

test('the first screen says what the site does and an example answers in one tap', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('h1')).toHaveText('Going to native? Find your train.');
  await expect(page.locator('#live')).toContainText('trains on the move at', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Chennai → Madurai' }).click();
  await expect(page.locator('#result-title')).toHaveText('Chennai → Madurai', { timeout: 30_000 });
  await expect(page.locator('.examples')).toBeHidden();
});

test('a place with no railway gets the nearest station, not a blank', async ({ page }) => {
  await page.goto('./?from=Delhi&to=Leh');
  await expect(page.locator('#result-title')).toHaveText('Delhi → Leh', { timeout: 30_000 });
  await expect(page.locator('.note').first()).toContainText('There is no railway in Ladakh yet');
  await expect(page.locator('.steps li')).not.toHaveCount(0);
});

for (const path of ['./', './methods.html']) {
  test(`no WCAG 2.2 AA violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    if (path === './') await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test('explore mode loads with the imagery credit and passes accessibility checks', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await page.click('#explore');
  await expect(page.locator('#status')).toContainText('Tap a train', { timeout: 60_000 });
  await expect(page.locator('#satellite-credit')).toBeVisible();
  // Zoom in so stations, district outlines and labels are on screen for the scan.
  await page.evaluate(() => (window as unknown as { nativePlaceMap: { flyTo: (a: number, b: number, c: number) => void } }).nativePlaceMap.flyTo(77.5696, 12.9782, 12));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.click('#explore');
  await expect(page.locator('#satellite-credit')).toBeHidden();
});
