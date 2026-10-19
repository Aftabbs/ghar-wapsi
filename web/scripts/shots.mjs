// Screenshots at real device sizes: node scripts/shots.mjs [baseUrl] [outDir]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const out = process.argv[3] ?? 'shots';
const devices = [
  { name: 'phone-390x844', width: 390, height: 844, dpr: 2, mobile: true },
  { name: 'phone-360x640', width: 360, height: 640, dpr: 2, mobile: true },
  { name: 'laptop-1440x900', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'laptop-1280x720', width: 1280, height: 720, dpr: 1, mobile: false },
];

// Use the real GPU: headless software GL takes ~10 s per frame of this map.
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
for (const d of devices) {
  const page = await browser.newPage({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: d.mobile,
    hasTouch: d.mobile,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30000 });
  await page.click('#play'); // pause: software GL cannot screenshot a live animation
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.screenshot({ path: `${out}/${d.name}.png` });
  console.log(d.name, overflow ? 'HORIZONTAL OVERFLOW' : 'ok', errors.length ? errors : '');
  await page.close();
}
await browser.close();
