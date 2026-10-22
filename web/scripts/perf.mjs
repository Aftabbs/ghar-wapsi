// How the site feels on a mid-range phone: node scripts/perf.mjs [baseUrl] [cpuSlowdown]
// Reports load time, frame rate, main-thread freezes and how long a search takes.
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const slowdown = Number(process.argv[3] ?? 4);
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
await page.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) });
  }).observe({ type: 'longtask', buffered: true });
});
const t0 = Date.now();
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 120000 });
const ready = Date.now() - t0;

const fps = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const times = [];
        const tick = (t) => {
          times.push(t);
          if (t - times[0] < 4000) requestAnimationFrame(tick);
          else {
            const gaps = times.slice(1).map((x, i) => x - times[i]).sort((a, b) => a - b);
            done({ fps: Math.round((times.length - 1) / 4), p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)]) });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
await page.waitForTimeout(3000); // let background loading settle
const idle = await fps();
const longLoad = await page.evaluate(() => window.__long.splice(0));

const typeStart = Date.now();
await page.fill('#from', '');
await page.type('#from', 'Benga', { delay: 80 });
const typing = Date.now() - typeStart - 5 * 80;
const suggestions = await page.$$eval('#from-suggestions li', (li) => li.map((x) => x.textContent));
await page.keyboard.press('Escape');
await page.evaluate(() => document.activeElement.blur());
const longTyping = await page.evaluate(() => window.__long.splice(0));

const s0 = Date.now();
await page.getByRole('button', { name: 'Bengaluru → Patna' }).click();
await page.waitForSelector('#result-title');
const search = Date.now() - s0;
const longSearch = await page.evaluate(() => window.__long.splice(0));
const answered = await fps();

const sum = (l) => l.reduce((s, e) => s + e.ms, 0);
console.log(JSON.stringify({
  slowdown,
  readyMs: ready,
  idle,
  longTasksDuringLoad: { count: longLoad.length, totalMs: sum(longLoad), worst: Math.max(0, ...longLoad.map((e) => e.ms)) },
  typingOverheadMs: typing,
  suggestions,
  longTasksTyping: sum(longTyping),
  searchMs: search,
  longTasksSearch: { totalMs: sum(longSearch), worst: Math.max(0, ...longSearch.map((e) => e.ms)) },
  answered,
}, null, 1));
await browser.close();
