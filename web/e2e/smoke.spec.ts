import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Reduced motion keeps the map still, so the test does not depend on a GPU.
test.use({ reducedMotion: 'reduce' });

test('map loads, modes work, and a card can be made', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./');
  await expect(page.locator('#festival')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#status')).toContainText('reduced motion');

  await page.click('#festival');
  await expect(page.locator('#legend')).toContainText('verified Diwali–Chhath specials heading home');
  await page.click('#bengaluru');
  await expect(page.locator('#legend')).toContainText('leaving Bengaluru');

  await page.click('#make-card');
  await page.selectOption('#card-city', 'bengaluru');
  await page.selectOption('#card-state', 'Bihar');
  await page.selectOption('#card-district', { label: 'Patna' });
  await expect(page.locator('#card-download')).toBeVisible();
  await expect(page.locator('#card-canvas')).toHaveAttribute('aria-label', /Bengaluru → Patna/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#make-card')).toBeFocused();
  expect(errors).toEqual([]);
});

for (const path of ['./', './methods.html']) {
  test(`no WCAG 2.2 AA violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    if (path === './') await expect(page.locator('#festival')).toBeEnabled({ timeout: 30_000 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test('explore mode loads with the imagery credit and passes accessibility checks', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#festival')).toBeEnabled({ timeout: 30_000 });
  await page.click('#explore');
  await expect(page.locator('#status')).toContainText('Tap a train', { timeout: 60_000 });
  await expect(page.locator('#satellite-credit')).toBeVisible();
  // Zoom in so stations, district outlines and labels are on screen for the scan.
  await page.evaluate(() => (window as unknown as { gharMap: { flyTo: (a: number, b: number, c: number) => void } }).gharMap.flyTo(77.5696, 12.9782, 12));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.click('#explore');
  await expect(page.locator('#satellite-credit')).toBeHidden();
});
