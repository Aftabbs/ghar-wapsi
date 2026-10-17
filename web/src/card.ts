// "My journey home" card: facts from sourced data only, drawn on a 1080x1920 canvas.

import { isHomeward, type Special } from './festival';

export interface RouteData {
  cities: Record<string, { name: string; districts: number[] }>;
  routes: Record<string, Record<string, [number, string] | [number, string, number]>>;
  districts: Record<string, [string, string, number, number]>; // name, state, lon, lat
}

export interface Migration {
  districts: Record<string, { name: string; state: string; from: Record<string, number> }>;
}

export interface TrainMeta {
  n: string;
  name: string;
}

export interface CardFacts {
  title: string;
  from: [number, number];
  to: [number, number];
  lines: { text: string; source: string }[];
}

const SPECIALS_AS_OF = '17 Oct 2026';

export function formatIndian(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function haversineKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function cardFacts(
  cityId: string,
  homeDistrict: string,
  data: { routes: RouteData; migration: Migration; specials: Special[]; trains: Map<string, string> },
): CardFacts {
  const city = data.routes.cities[cityId];
  const [homeName, homeState, homeLon, homeLat] = data.routes.districts[homeDistrict];
  const [, cityState, cityLon, cityLat] = data.routes.districts[String(city.districts[0])];
  const from: [number, number] = [cityLon, cityLat];
  const to: [number, number] = [homeLon, homeLat];
  const lines: CardFacts['lines'] = [];

  const km = haversineKm(from, to);
  lines.push({ text: `${formatIndian(Math.round(km / 10) * 10)} km away, as the crow flies`, source: 'distance' });

  const route = data.routes.routes[cityId]?.[homeDistrict];
  if (route) {
    const [hours, number, via] = route;
    const name = data.trains.get(number);
    const train = name ? `${number} ${name}` : number;
    const time = `about ${Math.round(hours)} h`;
    lines.push(
      via === undefined
        ? { text: `Fastest direct train: ${train}, ${time}`, source: '2016 timetable' }
        : {
            text: `Nearest direct train goes to ${data.routes.districts[String(via)][0]}: ${train}, ${time}`,
            source: '2016 timetable',
          },
    );
  } else {
    lines.push({ text: 'No direct train in the 2016 timetable', source: '2016 timetable' });
  }

  const inCity = new Set(city.districts);
  const specials = data.specials.filter(
    (s) => isHomeward(s) && s.oDistrict != null && inCity.has(s.oDistrict) && s.dState === homeState,
  );
  lines.push(
    specials.length
      ? {
          text: `${specials.length} verified festival special${specials.length > 1 ? 's' : ''} from ${city.name} to ${homeState} this season`,
          source: `official railway notices, as of ${SPECIALS_AS_OF}`,
        }
      : {
          text: `No verified festival special from ${city.name} to ${homeState} yet`,
          source: `official railway notices, as of ${SPECIALS_AS_OF}`,
        },
  );

  if (homeState !== cityState) {
    const people = city.districts.reduce(
      (sum, d) => sum + (data.migration.districts[String(d)]?.from[homeState] ?? 0),
      0,
    );
    if (people > 0) {
      lines.push({
        text: `${formatIndian(people)} people from ${homeState} lived in ${city.name} in 2011`,
        source: 'Census 2011, all reasons for moving',
      });
    }
  }

  return { title: `${city.name} → ${homeName}`, from, to, lines };
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
    `${weight} ${size}px 'Noto Sans', 'Noto Sans Devanagari', system-ui, sans-serif`;

  ctx.fillStyle = '#070b16';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#ffb347';
  ctx.font = font(40, 600);
  ctx.fillText('GHAR WAPSI · MY JOURNEY HOME', 90, 140);
  ctx.fillStyle = '#f3f1ea';
  ctx.font = font(72, 700);
  const titleLines = wrap(ctx, facts.title, W - 180);
  titleLines.forEach((line, i) => ctx.fillText(line, 90, 235 + i * 84));

  // Measure the facts first; the map takes whatever height is left.
  ctx.font = font(46, 600);
  const blocks = facts.lines.map((line) => wrap(ctx, line.text, W - 180));
  const textHeight = blocks.reduce((h, parts) => h + parts.length * 58 + 74, 0);
  const top = 235 + titleLines.length * 84;
  const map: Box = { x: 90, y: top, w: 900, h: FOOTER_TOP - textHeight - top - 60 };

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

  let y = map.y + map.h + 80;
  for (const [i, line] of facts.lines.entries()) {
    ctx.fillStyle = '#f3f1ea';
    ctx.font = font(46, 600);
    for (const part of blocks[i]) {
      ctx.fillText(part, 90, y);
      y += 58;
    }
    ctx.fillStyle = '#a9b1c6';
    ctx.font = font(30);
    ctx.fillText(line.source, 90, y);
    y += 74;
  }

  ctx.fillStyle = '#a9b1c6';
  ctx.font = font(28);
  ctx.fillText(siteUrl, 90, H - 110);
  ctx.fillText('Census 2011 · Indian Railways · DataMeet · © OpenStreetMap contributors', 90, H - 66);
}
