// "My journey home" card: facts from sourced data only, drawn on a 1080x1920 canvas.

import { isHomeward, type Special } from './festival';

export interface RouteData {
  cities: Record<string, { name: string; districts: number[] }>;
  routes: Record<string, Record<string, [number, string] | [number, string, number]>>;
  // name, Census 2011 state, lon, lat, state today (Telangana became a state in 2014)
  districts: Record<string, [string, string, number, number, string]>;
}

export interface Migration {
  districts: Record<string, { name: string; state: string; from: Record<string, number> }>;
}

export interface RailTravel {
  source: string;
  year: number;
  shares: Record<string, Record<string, number>>; // origin state -> destination state -> %
}

export interface TrainMeta {
  n: string;
  name: string;
}

export interface Narration {
  en: string;
  hi: string;
}

export interface Narrations {
  model: string;
  cards: Record<string, Narration>; // "cityId|home state"
}

export interface CardFacts {
  title: string;
  from: [number, number];
  to: [number, number];
  // AI-written summary of the lines below; null if none passed the checks.
  narration: Narration | null;
  lines: { text: string; source: string }[];
}

const SPECIALS_AS_OF = '17 Oct 2026';
const TIMETABLE = 'Trains at a Glance 2026';

/** The name people use: official data says "NCT of Delhi". */
function spoken(state: string): string {
  return state === 'NCT of Delhi' ? 'Delhi' : state;
}

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
  data: {
    routes: RouteData;
    migration: Migration;
    travel: RailTravel;
    specials: Special[];
    trains: Map<string, string>;
    narrations?: Narrations;
  },
): CardFacts {
  const city = data.routes.cities[cityId];
  const [homeName, homeState2011, homeLon, homeLat, homeState] = data.routes.districts[homeDistrict];
  const [, cityState2011, cityLon, cityLat, cityState] = data.routes.districts[String(city.districts[0])];
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
    const time =
      hours < 1.5
        ? `about ${Math.max(5, Math.round((hours * 60) / 5) * 5)} min`
        : `about ${Math.round(hours)} h`;
    lines.push(
      via === undefined
        ? { text: `Fastest direct train: ${train}, ${time}`, source: TIMETABLE }
        : {
            text: `Nearest direct train goes to ${data.routes.districts[String(via)][0]}: ${train}, ${time}`,
            source: TIMETABLE,
          },
    );
  } else {
    lines.push({ text: `No direct train listed in ${TIMETABLE}`, source: TIMETABLE });
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
    const share = data.travel.shares[homeState]?.[cityState];
    if (share !== undefined && share >= 0.01) {
      lines.push({
        text: `In ${data.travel.year}, ${share.toFixed(1)}% of long-distance unreserved train trips from ${homeState} went to ${spoken(cityState)}`,
        source: 'EAC-PM migration study, railway ticket data',
      });
    }
  }
  if (homeState2011 !== cityState2011) {
    const people = city.districts.reduce(
      (sum, d) => sum + (data.migration.districts[String(d)]?.from[homeState2011] ?? 0),
      0,
    );
    if (people > 0) {
      const from = homeState2011 === homeState ? homeState : `undivided ${homeState2011}`;
      lines.push({
        text: `${formatIndian(people)} people from ${from} lived in ${city.name}`,
        source: 'Census 2011, the latest count; Census 2027 results are pending',
      });
    }
  }

  const narration = data.narrations?.cards[`${cityId}|${homeState}`] ?? null;
  return { title: `${city.name} → ${homeName}`, from, to, narration, lines };
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
  ctx.fillText('GHAR WAPSI · MY JOURNEY HOME', 90, 140);
  ctx.fillStyle = '#f3f1ea';
  ctx.font = font(72, 700);
  const titleLines = wrap(ctx, facts.title, W - 180);
  titleLines.forEach((line, i) => ctx.fillText(line, 90, 235 + i * 84));

  // The story line in English and Hindi sits under the title.
  let top = 235 + titleLines.length * 84 - 20;
  if (facts.narration) {
    ctx.fillStyle = '#ffd27a';
    ctx.font = font(40, 500);
    for (const part of wrap(ctx, facts.narration.en, W - 180)) {
      top += 52;
      ctx.fillText(part, 90, top);
    }
    ctx.fillStyle = '#c9cfdd';
    ctx.font = font(36, 400);
    top += 14;
    for (const part of wrap(ctx, facts.narration.hi, W - 180)) {
      top += 50;
      ctx.fillText(part, 90, top);
    }
  }
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
