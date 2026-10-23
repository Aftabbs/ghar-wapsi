// X/Twitter header image (1500x500): node scripts/banner.mjs [baseUrl] [out]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'https://native-place.pages.dev/';
const out = process.argv[3] ?? 'shots/x-header.png';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 500 }, deviceScaleFactor: 2 });
await page.goto(`${base}?from=Bengaluru&to=Patna`);
await page.waitForSelector('#result-title', { timeout: 60000 });
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30000 });
await page.waitForTimeout(2000);
await page.click('#play');
await page.evaluate(() => {
  for (const sel of ['.panel', '.attribution', '#live']) document.querySelector(sel).style.display = 'none';
  // The profile photo covers the bottom left of an X header, so the words sit on the right.
  const card = document.createElement('div');
  card.innerHTML = `
    <div style="font:700 15px system-ui;letter-spacing:.08em;color:#ffb347">● NATIVE PLACE</div>
    <div style="font:800 52px/1.05 system-ui;color:#f3f1ea;margin-top:10px">Find the train<br>to your <span style="color:#ffb347">hometown</span></div>
    <div style="font:500 19px system-ui;color:#c9cfdd;margin-top:14px">Every train in India's official 2026 timetable</div>
    <div style="font:600 19px system-ui;color:#ffd27a;margin-top:6px">native-place.pages.dev</div>`;
  Object.assign(card.style, { position: 'absolute', right: '70px', top: '90px', zIndex: 10, textAlign: 'left',
    padding: '26px 32px', borderRadius: '18px', background: 'rgba(7,11,22,.78)', border: '1px solid #22304f' });
  document.body.append(card);
});
await page.evaluate(() => window.nativePlaceMap.flyTo(80.5, 21.5, 4.1));
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
