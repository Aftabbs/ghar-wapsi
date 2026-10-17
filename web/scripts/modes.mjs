// Screenshots of each mode: node scripts/modes.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['laptop', { width: 1440, height: 900 }, false]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('#festival').disabled, null, { timeout: 30000 });
  await page.click('#festival');
  await page.waitForTimeout(2500);
  await page.click('#play');
  await page.screenshot({ path: `shots/${name}-festival.png` });
  console.log(name, 'festival legend:', await page.textContent('#legend'));
  await page.click('#play');
  await page.click('#bengaluru');
  await page.waitForTimeout(2500);
  await page.click('#play');
  await page.screenshot({ path: `shots/${name}-bengaluru.png` });
  console.log(name, 'bengaluru legend:', await page.textContent('#legend'), errors);
  await page.close();
}
await browser.close();
