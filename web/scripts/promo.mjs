// Launch video, step 1: record a real search at phone size, sharp (2x), with a tap marker.
// node scripts/promo.mjs [baseUrl] [outDir]  ->  frames/*.jpg, frames.txt (ffmpeg concat), cues.json
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'https://native-place.pages.dev/';
const out = process.argv[3] ?? 'shots/promo';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/frames`, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
// A soft circle wherever the screen is tapped, so viewers can follow along.
await page.addInitScript(() => {
  addEventListener('pointerdown', (e) => {
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'fixed', left: `${e.clientX - 22}px`, top: `${e.clientY - 22}px`, width: '44px', height: '44px',
      borderRadius: '50%', background: 'rgba(255,255,255,.35)', border: '2px solid rgba(255,255,255,.9)',
      zIndex: 99999, pointerEvents: 'none', transition: 'transform .5s ease-out, opacity .5s ease-out',
    });
    document.documentElement.append(dot);
    requestAnimationFrame(() => { dot.style.transform = 'scale(1.6)'; dot.style.opacity = '0'; });
    setTimeout(() => dot.remove(), 600);
  }, true);
});

const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
  writeFileSync(`${out}/frames/${file}`, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });
await page.waitForTimeout(1500); // let the map settle before recording starts
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688 });
const t0 = Date.now() / 1000;
const cues = [];
const cue = (text) => cues.push({ at: Date.now() / 1000 - t0, text });
const pause = (ms) => page.waitForTimeout(ms);

cue("Going to native this Diwali?");
await pause(2200);
cue("Where do you live?");
await page.locator('#from').tap();
await page.locator('#from').pressSequentially('Bengaluru', { delay: 90 });
await page.getByRole('option', { name: 'Bengaluru, Karnataka' }).tap();
await pause(400);
cue("Where's home? Even a small town works");
await page.locator('#to').tap();
await page.locator('#to').pressSequentially('Kadur', { delay: 120 });
await page.getByRole('option', { name: 'Kadur, Chikkamagaluru, Karnataka' }).waitFor();
await pause(900);
await page.getByRole('option', { name: 'Kadur, Chikkamagaluru, Karnataka' }).tap();
await pause(300);
cue("Pick your travel date");
await page.fill('#when', '2026-11-06');
await pause(900);
await page.locator('#find').tap();
await page.waitForSelector('#result-title');
cue("Your train, from the official timetable");
await pause(3600);
cue("Fare for every class");
await page.evaluate(() => document.querySelector('.panel').scrollBy({ top: 300, behavior: 'smooth' }));
await pause(2600);
cue("Share it with family");
await page.locator('#make-card').tap();
await page.waitForSelector('#card-download:not([hidden])');
await pause(2800);
const end = Date.now() / 1000 - t0;
await cdp.send('Page.stopScreencast');
await browser.close();

// ffmpeg concat list: each frame lasts until the next one arrived.
const lines = [];
frames.forEach((f, i) => {
  const next = frames[i + 1]?.t ?? f.t + 0.05;
  lines.push(`file 'frames/${f.file}'`, `duration ${(next - f.t).toFixed(4)}`);
});
lines.push(`file 'frames/${frames.at(-1).file}'`);
writeFileSync(`${out}/frames.txt`, lines.join('\n'));
const start = frames[0].t;
writeFileSync(`${out}/cues.json`, JSON.stringify({ cues, end, firstFrame: start - (t0) }, null, 1));
console.log(`${frames.length} frames over ${end.toFixed(1)} s`, cues.map((c) => `${c.at.toFixed(1)} ${c.text}`));
