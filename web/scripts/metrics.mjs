// Where main-thread time goes over 4 s of animation: node scripts/metrics.mjs [baseUrl] [slowdown]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.argv[3] ?? 4) });
await cdp.send('Performance.enable');
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 120000 });
await page.waitForTimeout(4000);
const read = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const a = await read();
await page.waitForTimeout(4000);
const b = await read();
const keys = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
console.log(Object.fromEntries(keys.map((k) => [k, Math.round((b[k] - a[k]) * (k.endsWith('Count') ? 1 : 1000))])));
await browser.close();
