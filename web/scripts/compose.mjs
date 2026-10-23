// Launch video, step 2: put the recording in a phone frame on a 4:5 canvas with captions
// and an end card. node scripts/compose.mjs [promoDir] [out.mp4]   (needs FFMPEG=path)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const dir = process.argv[2] ?? 'shots/promo';
const outFile = process.argv[3] ?? `${dir}/native-place-launch.mp4`;
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const { cues, end } = JSON.parse(readFileSync(`${dir}/cues.json`, 'utf8'));
const W = 1080, H = 1920; // 9:16: X shows it uncropped, and the phone can be large enough to read
const PH = 1540, PW = Math.round((PH * 780) / 1688), PX = (W - PW) / 2, PY = 270, R = 64;
const END_SECONDS = 2.8;
const FONT = `'Segoe UI', 'Noto Sans', system-ui, sans-serif`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
async function png(html, file, transparent = true) {
  await page.setContent(`<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:${FONT}">${html}</body>`);
  await page.screenshot({ path: `${dir}/${file}`, omitBackground: transparent });
}

// Background: dark navy with a warm glow, like the site.
await png(
  `<div style="position:absolute;inset:0;background:radial-gradient(900px 700px at 50% 85%,#3b2410 0%,#0b1222 55%,#070b16 100%)"></div>`,
  'bg.png', false,
);
// Frame on top of the video: the canvas outside a rounded screen, plus a bezel.
await png(
  `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
     <defs><radialGradient id="g" cx="50%" cy="85%" r="75%"><stop offset="0" stop-color="#3b2410"/><stop offset=".55" stop-color="#0b1222"/><stop offset="1" stop-color="#070b16"/></radialGradient></defs>
     <path fill="url(#g)" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${PX + R} ${PY}H${PX + PW - R}A${R} ${R} 0 0 1 ${PX + PW} ${PY + R}V${PY + PH - R}A${R} ${R} 0 0 1 ${PX + PW - R} ${PY + PH}H${PX + R}A${R} ${R} 0 0 1 ${PX} ${PY + PH - R}V${PY + R}A${R} ${R} 0 0 1 ${PX + R} ${PY}Z"/>
     <rect x="${PX - 7}" y="${PY - 7}" width="${PW + 14}" height="${PH + 14}" rx="${R + 7}" fill="none" stroke="#1d2741" stroke-width="10"/>
     <rect x="${PX - 12}" y="${PY - 12}" width="${PW + 24}" height="${PH + 24}" rx="${R + 12}" fill="none" stroke="#ffb347" stroke-opacity=".25" stroke-width="2"/>
   </svg>
   <div style="position:absolute;left:0;right:0;top:${PY + PH + 34}px;text-align:center;font:600 36px ${FONT};color:#ffd27a">native-place.pages.dev</div>`,
  'frame.png',
);
// One caption per step, above the phone.
for (const [i, c] of cues.entries()) {
  await png(
    `<div style="position:absolute;left:60px;right:60px;top:60px;text-align:center">
       <div style="font:700 22px ${FONT};letter-spacing:.14em;color:#ffb347">● NATIVE PLACE</div>
       <div style="font:800 64px/1.1 ${FONT};color:#f3f1ea;margin-top:16px">${c.text}</div>
     </div>`,
    `cap${i}.png`,
  );
}
// End card.
await png(
  `<div style="position:absolute;inset:0;background:rgba(7,11,22,.93);display:grid;place-content:center;text-align:center;gap:22px">
     <div style="font:700 26px ${FONT};letter-spacing:.14em;color:#ffb347">● NATIVE PLACE</div>
     <div style="font:800 96px/1.05 ${FONT};color:#f3f1ea">Find the train<br>to your <span style="color:#ffb347">hometown</span></div>
     <div style="font:500 38px ${FONT};color:#c9cfdd">Every district, 5 lakh+ towns and villages.<br>Official 2026 railway timetable. Free.</div>
     <div style="margin:18px auto 0;padding:18px 34px;border-radius:999px;background:#ffb347;color:#1a1206;font:700 46px ${FONT}">native-place.pages.dev</div>
   </div>`,
  'end.png',
);
await browser.close();

// Captions longer than the phone step they describe would overlap, so each runs to the next.
const capInputs = cues.flatMap((_, i) => ['-loop', '1', '-i', `${dir}/cap${i}.png`]);
const total = end + END_SECONDS;
let chain = `[1:v]fps=30,scale=${PW}:${PH}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${END_SECONDS}[ph];` +
  `[0:v][ph]overlay=${PX}:${PY}:shortest=1[v0];[v0][2:v]overlay=0:0[v1];`;
let last = 'v1';
cues.forEach((c, i) => {
  const to = cues[i + 1]?.at ?? end;
  chain += `[${last}][${3 + i}:v]overlay=0:0:enable='between(t,${c.at.toFixed(2)},${to.toFixed(2)})'[c${i}];`;
  last = `c${i}`;
});
const endIdx = 3 + cues.length;
chain += `[${last}][${endIdx}:v]overlay=0:0:enable='gte(t,${end.toFixed(2)})',format=yuv420p[out]`;
execFileSync(ffmpeg, [
  '-y', '-loglevel', 'error',
  '-loop', '1', '-i', `${dir}/bg.png`,
  '-f', 'concat', '-safe', '0', '-i', `${dir}/frames.txt`,
  '-loop', '1', '-i', `${dir}/frame.png`,
  ...capInputs,
  '-loop', '1', '-i', `${dir}/end.png`,
  '-filter_complex', chain, '-map', '[out]', '-t', total.toFixed(2),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', '30', '-movflags', '+faststart', outFile,
], { stdio: 'inherit' });
console.log('wrote', outFile, `${total.toFixed(1)} s`);
