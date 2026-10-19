// The link preview image (WhatsApp, X, LinkedIn): node scripts/og.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(`${base}?from=Bengaluru&to=Patna`);
await page.waitForSelector('#result-title', { timeout: 60000 });
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.click('#play');
// The preview shows the promise and the search with the route lit, not the long answer.
await page.evaluate(() => {
  document.body.classList.remove('answered');
  for (const sel of ['#result', '.map-tools', '.examples', '#season', '#search-hint']) {
    document.querySelector(sel).style.display = 'none';
  }
  document.querySelector('h1').style.fontSize = '2.6rem';
  document.querySelector('.panel').style.bottom = 'auto';
  document.querySelector('.panel').scrollTop = 0;
});
await page.screenshot({ path: 'public/og.png' });
await browser.close();
