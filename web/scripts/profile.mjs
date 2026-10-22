// CPU profile of load + one search; prints the functions with the most self time.
// node scripts/profile.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
const phase = process.argv[3] ?? 'all'; // 'all' = load + search, 'idle' = 4 s of steady animation
if (phase === 'type') {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await cdp.send('Profiler.start');
  await page.type('#from', 'Benga', { delay: 80 });
} else if (phase === 'search') {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await cdp.send('Profiler.start');
  await page.getByRole('button', { name: 'Bengaluru → Patna' }).click();
  await page.waitForSelector('#result-title');
  await page.waitForTimeout(300);
} else if (phase === 'idle') {
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 120000 });
  await page.waitForTimeout(5000);
  await cdp.send('Profiler.start');
  await page.waitForTimeout(4000);
} else {
  await cdp.send('Profiler.start');
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.type('#from', 'Benga', { delay: 80 });
  await page.getByRole('button', { name: 'Bengaluru → Patna' }).click();
  await page.waitForSelector('#result-title');
  await page.waitForTimeout(1000);
}
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
});
// Which layer (or other caller) the shader link time belongs to.
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const owner = new Map();
profile.samples.forEach((id, i) => {
  if (byId.get(id).callFrame.functionName !== '_getLinkStatus') return;
  let cur = id;
  const chain = [];
  while (cur) {
    const name = byId.get(cur).callFrame.functionName;
    if (/Layer|^_?(initialize|update|draw|getModel|_getModel|render)/.test(name)) chain.push(name);
    cur = parent.get(cur);
  }
  const key = chain.slice(0, 4).join(' < ');
  owner.set(key, (owner.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
});
for (const [k, v] of [...owner].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log('link', Math.round(v).toString().padStart(6), k);
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log('total ms', Math.round(total));
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(Math.round(v).toString().padStart(6), k);
await browser.close();
