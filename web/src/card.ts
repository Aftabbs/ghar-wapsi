// The share card: facts from sourced data only, drawn on a 1080x1920 canvas.

export interface Migration {
  districts: Record<string, { name: string; state: string; from: Record<string, number> }>;
}

export interface RailTravel {
  source: string;
  year: number;
  shares: Record<string, Record<string, number>>; // origin state -> destination state -> %
}

export interface CardFacts {
  title: string;
  from: [number, number];
  to: [number, number];
  lines: { text: string; source: string }[];
}

// ---- drawing -------------------------------------------------------------

type Ring = [number, number][];
interface StatesGeo {
  features: { geometry: { type: string; coordinates: unknown } }[];
}

const W = 1080;
const H = 1920;
const FOOTER_TOP = H - 170;
const BOUNDS = { minLon: 68, maxLon: 97.5, minLat: 6.5, maxLat: 37.5 };

type Box = { x: number; y: number; w: number; h: number };

function project([lon, lat]: [number, number], box: Box): [number, number] {
  // Equirectangular with a mid-latitude correction; plenty for a postcard.
  const k = Math.cos((22 * Math.PI) / 180);
  const sx = box.w / ((BOUNDS.maxLon - BOUNDS.minLon) * k);
  const sy = box.h / (BOUNDS.maxLat - BOUNDS.minLat);
  const s = Math.min(sx, sy);
  const ox = box.x + (box.w - (BOUNDS.maxLon - BOUNDS.minLon) * k * s) / 2;
  return [ox + (lon - BOUNDS.minLon) * k * s, box.y + (BOUNDS.maxLat - lat) * s];
}

function rings(geometry: { type: string; coordinates: unknown }): Ring[] {
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as Ring[][]).flat();
  return [];
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export function drawCard(canvas: HTMLCanvasElement, facts: CardFacts, states: StatesGeo, siteUrl: string) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const font = (size: number, weight = 400) =>
    `${weight} ${size}px 'Noto Sans', 'Noto Sans Devanagari', 'Nirmala UI', 'Kohinoor Devanagari', system-ui, sans-serif`;

  ctx.fillStyle = '#070b16';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#ffb347';
  ctx.font = font(40, 600);
  ctx.fillText('HOMEWARD · MY TRAIN HOME', 90, 140);
  ctx.fillStyle = '#f3f1ea';
  ctx.font = font(72, 700);
  const titleLines = wrap(ctx, facts.title, W - 180);
  titleLines.forEach((line, i) => ctx.fillText(line, 90, 235 + i * 84));

  let top = 235 + titleLines.length * 84 - 20;
  top += 30;

  // Measure the facts first; the map takes whatever height is left.
  ctx.font = font(42, 600);
  const blocks = facts.lines.map((line) => wrap(ctx, line.text, W - 180));
  const textHeight = blocks.reduce((h, parts) => h + parts.length * 52 + 64, 0);
  const map: Box = { x: 90, y: top, w: 900, h: FOOTER_TOP - textHeight - top - 40 };

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#22304f';
  ctx.fillStyle = '#0f1628';
  for (const feature of states.features) {
    for (const ring of rings(feature.geometry)) {
      ctx.beginPath();
      ring.forEach((pt, i) => {
        const [x, y] = project(pt, map);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  const [x0, y0] = project(facts.from, map);
  const [x1, y1] = project(facts.to, map);
  const cx = (x0 + x1) / 2 - (y1 - y0) * 0.25;
  const cy = (y0 + y1) / 2 + (x1 - x0) * 0.25 - 40;
  ctx.shadowColor = 'rgba(255, 205, 90, 0.9)';
  ctx.shadowBlur = 24;
  ctx.strokeStyle = '#ffcd5a';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
  for (const [x, y, r] of [
    [x0, y0, 11],
    [x1, y1, 16],
  ]) {
    ctx.fillStyle = '#ffe3a3';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  let y = map.y + map.h + 60;
  for (const [i, line] of facts.lines.entries()) {
    ctx.fillStyle = '#f3f1ea';
    ctx.font = font(42, 600);
    for (const part of blocks[i]) {
      ctx.fillText(part, 90, y);
      y += 52;
    }
    ctx.fillStyle = '#a9b1c6';
    ctx.font = font(28);
    ctx.fillText(line.source, 90, y);
    y += 64;
  }

  ctx.fillStyle = '#a9b1c6';
  ctx.font = font(28);
  ctx.fillText(siteUrl, 90, H - 110);
  ctx.fillText('Indian Railways · EAC-PM · Census of India · © OpenStreetMap contributors', 90, H - 66);
}
