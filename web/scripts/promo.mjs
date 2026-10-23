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

// Warm the caches first (explore data, satellite tiles around Bengaluru), so the recording
// shows the product, not loading spinners. Then start clean.
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });
await page.locator('#explore').click();
await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('Tap a train'), null, { timeout: 90000 });
await page.evaluate(() => window.nativePlaceMap.flyTo(77.5696, 12.99, 11.3));
await page.waitForTimeout(6000);
// Back to the start without a reload, so the warmed data stays in memory.
await page.locator('#explore').click();
await page.evaluate(() => window.nativePlaceMap.home());
await page.evaluate(() => document.querySelector('.panel').scrollTo({ top: 0 }));
await page.waitForTimeout(1500); // let the map settle before recording starts
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688 });
const t0 = Date.now() / 1000;
const cues = [];
const cue = (text) => cues.push({ at: Date.now() / 1000 - t0, text });
const pause = (ms) => page.waitForTimeout(ms);

// Scene 1: the hook, the live map.
cue('Going to native this Diwali?');
await pause(2000);

// Scene 2: a small town, on a date.
cue('Where do you live?');
await page.locator('#from').tap();
await page.locator('#from').pressSequentially('Bengaluru', { delay: 70 });
await page.getByRole('option', { name: 'Bengaluru, Karnataka' }).tap();
cue("Where's home? Even a small town works");
await page.locator('#to').tap();
await page.locator('#to').pressSequentially('Kadur', { delay: 100 });
await page.getByRole('option', { name: 'Kadur, Chikkamagaluru, Karnataka' }).waitFor();
await pause(700);
await page.getByRole('option', { name: 'Kadur, Chikkamagaluru, Karnataka' }).tap();
cue('Pick your travel date');
await page.fill('#when', '2026-11-06');
await pause(600);
await page.locator('#find').tap();
await page.waitForSelector('#result-title');
cue('Your train, from the official timetable');
await pause(3000);

// Scene 3: across India, with special trains and the people who make the same trip.
cue('Or anywhere across India');
await page.locator('#new-search').tap();
await page.locator('#to').fill('');
await page.locator('#when').fill('');
await page.locator('#to').tap();
await page.locator('#to').pressSequentially('Patna', { delay: 90 });
await pause(500);
await page.locator('#to').press('Enter'); // the best match, Patna, Bihar
await page.waitForSelector('#result-title');
await pause(2600);
cue('Fare for every class');
await page.evaluate(() => {
  const panel = document.querySelector('.panel');
  const fares = document.querySelector('.fares');
  panel.scrollTo({ top: fares.offsetTop - 120, behavior: 'smooth' });
});
await pause(2200);
cue('Special trains this season, and who else makes the trip');
await page.evaluate(() => {
  const panel = document.querySelector('.panel');
  const target = document.querySelector('.specials') ?? document.querySelector('.people');
  panel.scrollTo({ top: target.offsetTop - 140, behavior: 'smooth' });
});
await pause(2600);
cue('Share it with family');
await page.locator('#make-card').tap();
await page.waitForSelector('#card-download:not([hidden])');
await pause(2400);
await page.locator('#card-close').tap();
await page.locator('#new-search').tap();

// Scene 4: explore mode.
cue('Explore every train on a satellite map');
await page.evaluate(() => document.querySelector('.panel').scrollTo({ top: 1e6 }));
await page.locator('#explore').tap();
await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('Tap a train'), null, { timeout: 60000 });
await page.evaluate(() => window.nativePlaceMap.flyTo(77.5696, 12.99, 11.3));
await pause(2600); // satellite tiles and station names appear
cue('Tap any station for its next trains');
const at = await page.evaluate(() => window.nativePlaceMap.project(77.5696, 12.9782));
await page.touchscreen.tap(at[0], at[1]);
await page.waitForSelector('#info:not([hidden])');
await pause(1200);
await page.locator('#info summary').tap(); // open "Next departures"
await pause(3000);
const end = Date.now() / 1000 - t0;
await cdp.send('Page.stopScreencast');
await browser.close();

// ffmpeg concat list: each frame lasts until the next one. Frames can arrive out of order.
frames.sort((a, b) => a.t - b.t);
const lines = [];
frames.forEach((f, i) => {
  const next = frames[i + 1]?.t ?? f.t + 0.05;
  lines.push(`file 'frames/${f.file}'`, `duration ${Math.max(next - f.t, 0.001).toFixed(4)}`);
});
lines.push(`file 'frames/${frames.at(-1).file}'`);
writeFileSync(`${out}/frames.txt`, lines.join('\n'));
const start = frames[0].t;
writeFileSync(`${out}/cues.json`, JSON.stringify({ cues, end, firstFrame: start - (t0) }, null, 1));
console.log(`${frames.length} frames over ${end.toFixed(1)} s`, cues.map((c) => `${c.at.toFixed(1)} ${c.text}`));
