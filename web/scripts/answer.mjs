// An answer and its card at phone and laptop size:
// node scripts/answer.mjs [baseUrl] [from] [to]
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const [from, to] = [process.argv[3] ?? 'Bengaluru', process.argv[4] ?? 'Patna'];
const slug = `${from}-${to}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
for (const [name, viewport, mobile] of [
  ['phone', { width: 390, height: 844 }, true],
  ['laptop', { width: 1440, height: 900 }, false],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  await page.waitForSelector('#result-title', { timeout: 60000 });
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30000 });
  await page.waitForTimeout(1500); // the camera flies to the route
  await page.click('#play');
  await page.evaluate(() => (document.querySelector('.panel').scrollTop = 0));
  await page.screenshot({ path: `shots/${name}-${slug}.png` });
  if (name === 'laptop') {
    await page.click('#make-card');
    await page.waitForSelector('#card-download:not([hidden])');
    const png = await page.evaluate(() => document.querySelector('#card-canvas').toDataURL('image/png'));
    writeFileSync(`shots/card-${slug}.png`, Buffer.from(png.split(',')[1], 'base64'));
  }
  console.log(name, await page.textContent('#result-title'), errors);
}
await browser.close();
