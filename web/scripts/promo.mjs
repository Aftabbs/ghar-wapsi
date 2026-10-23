// A phone-sized screen recording for social posts: node scripts/promo.mjs [baseUrl] [outDir]
// Records a real search (Bengaluru -> Kadur), the answer and the share card.
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'https://native-place.pages.dev/';
const out = process.argv[3] ?? 'shots/promo';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: out, size: { width: 780, height: 1688 } },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });
await pause(2500); // the headline and the moving trains
await page.locator('#from').pressSequentially('Bengaluru', { delay: 110 });
await pause(600);
await page.getByRole('option', { name: 'Bengaluru, Karnataka' }).tap();
await pause(500);
await page.locator('#to').pressSequentially('Kadur', { delay: 140 });
await page.getByRole('option', { name: 'Kadur, Chikkamagaluru, Karnataka' }).waitFor();
await pause(900);
await page.getByRole('option', { name: 'Kadur, Chikkamagaluru, Karnataka' }).tap();
await pause(500);
await page.fill('#when', '2026-11-06');
await pause(700);
await page.locator('#find').tap();
await page.waitForSelector('#result-title');
await pause(3500); // the route lights up and the answer appears
await page.evaluate(() => document.querySelector('.panel').scrollBy({ top: 260, behavior: 'smooth' }));
await pause(2500); // the fares
await page.locator('#make-card').tap();
await page.waitForSelector('#card-download:not([hidden])');
await pause(3000); // the share card
await context.close();
await browser.close();
console.log('recorded');
