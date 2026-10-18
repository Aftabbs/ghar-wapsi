// Explore mode end to end: labels at several zooms, then tap a station, a district and a state.
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base);
await page.waitForFunction(() => !document.querySelector('#festival').disabled, null, { timeout: 30000 });
await page.click('#play');
await page.click('#explore');
await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Tap'), null, { timeout: 60000 });
const fly = (lon, lat, zoom) => page.evaluate(([a, b, c]) => window.gharMap.flyTo(a, b, c), [lon, lat, zoom]);
const panel = async () => (await page.textContent('#info-body')).replace(/\s+/g, ' ').trim().slice(0, 420);
const tap = async (x, y, name) => {
  await page.mouse.click(x, y);
  await page.waitForTimeout(700);
  console.log(`[${name}]`, await panel());
  await page.screenshot({ path: `shots/explore-${name}.png` });
};
await fly(77.6, 13.4, 7.2);
await page.waitForTimeout(5000);
await page.screenshot({ path: 'shots/explore-karnataka.png' });
await fly(77.5696, 12.9782, 13); // KSR Bengaluru station at the centre
await page.waitForTimeout(4000);
await tap(702, 457, "station");
await fly(76.3, 14.6, 8); // open countryside in Karnataka: a district
await page.waitForTimeout(3000);
await tap(720, 450, 'district');
await fly(85.5, 25.6, 5); // Bihar at state zoom
await page.waitForTimeout(3000);
await tap(720, 450, 'state');
console.log('errors', errors);
await browser.close();
