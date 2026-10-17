// Make a card end to end and save both the dialog and the card image.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5180/';
const [city, state, district] = [process.argv[3] ?? 'bengaluru', process.argv[4] ?? 'Bihar', process.argv[5] ?? 'Siwan'];
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base);
await page.waitForFunction(() => !document.querySelector('#festival').disabled, null, { timeout: 30000 });
await page.click('#play');
await page.click('#make-card');
await page.waitForFunction(() => document.querySelectorAll('#card-city option').length > 5);
await page.selectOption('#card-city', city);
await page.selectOption('#card-state', state);
await page.selectOption('#card-district', { label: district });
await page.waitForFunction(() => !document.querySelector('#card-download').hidden);
await page.screenshot({ path: 'shots/card-dialog.png' });
const png = await page.evaluate(() => document.querySelector('#card-canvas').toDataURL('image/png'));
writeFileSync(`shots/card-${city}-${district}.png`, Buffer.from(png.split(',')[1], 'base64'));
console.log('label:', await page.getAttribute('#card-canvas', 'aria-label'));
console.log('hint:', await page.textContent('#card-hint'), errors);
await browser.close();
