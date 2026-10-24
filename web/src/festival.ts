// Special trains for the season (now Diwali and Chhath 2026), drawn as arcs home.

import { DAY, WINDOW } from './data';

export interface Special {
  n: string;
  name: string;
  season: string; // e.g. "Diwali and Chhath 2026"
  o: string;
  d: string;
  oState: string | null;
  dState: string | null;
  oDistrict: number | null;
  dDistrict: number | null;
  from: [number, number];
  to: [number, number];
  dep: string | null;
  hours: number | null;
  days: string[];
  first: string | null;
  last: string | null;
  source: string;
  verified: string;
}

// States people mostly travel *from* in a holiday rush; a special leaving one of
// these for anywhere else is heading home. The reverse direction is the return trip.
export const WORK_HUBS = new Set([
  'NCT of Delhi',
  'Maharashtra',
  'Karnataka',
  'Gujarat',
  'Tamil Nadu',
  'Andhra Pradesh', // Hyderabad/Charlapalli sit in 2011 Andhra Pradesh
  'Punjab',
  'Chandigarh',
  'Haryana',
  'Kerala',
]);

export function isHomeward(s: Special): boolean {
  return WORK_HUBS.has(s.oState ?? '') && !WORK_HUBS.has(s.dState ?? '');
}

const ARC_POINTS = 32;

/** A gentle curve from origin to destination, bowed to the left of travel. */
export function arcPath(from: [number, number], to: [number, number]): [number, number][] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const bow = 0.18; // curve height as a fraction of the distance
  const cx = (x0 + x1) / 2 - dy * bow;
  const cy = (y0 + y1) / 2 + dx * bow;
  const points: [number, number][] = [];
  for (let i = 0; i <= ARC_POINTS; i++) {
    const t = i / ARC_POINTS;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push([a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1]);
  }
  return points;
}

export interface SpecialTrip {
  special: Special;
  path: [number, number][];
  timestamps: number[];
}

/**
 * Moving trips for specials whose notice gives departure and journey time. Each
 * appears on every clock day it would be travelling, like the regular trains.
 */
export function specialTrips(specials: Special[]): SpecialTrip[] {
  const out: SpecialTrip[] = [];
  for (const special of specials) {
    if (!special.dep || special.hours == null) continue;
    const [h, m] = special.dep.split(':').map(Number);
    const duration = special.hours * 60;
    const path = arcPath(special.from, special.to);
    for (let offset = -Math.ceil(duration / DAY) * DAY; offset < DAY; offset += DAY) {
      const start = WINDOW[0] + h * 60 + m + offset;
      if (start + duration <= WINDOW[0] || start >= WINDOW[1]) continue;
      out.push({
        special,
        path,
        timestamps: path.map((_, i) => start + (duration * i) / (path.length - 1)),
      });
    }
  }
  return out;
}

export function summary(specials: Special[]) {
  const homeward = specials.filter(isHomeward);
  const byState = new Map<string, number>();
  for (const s of homeward) byState.set(s.dState ?? '', (byState.get(s.dState ?? '') ?? 0) + 1);
  return {
    total: specials.length,
    homeward: homeward.length,
    verifiedOn: specials.map((s) => s.verified).sort().at(-1) ?? '',
    topStates: [...byState.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/**
 * How complete the special-train list is: which railway zones' notices it covers and
 * when they were last checked. Shown next to specials so the list never claims more.
 */
export function coverage(specials: Special[]): { zones: number; checked: string } {
  const zones = new Set(specials.map((s) => new URL(s.source).hostname.split('.')[0]));
  const checked = specials.map((s) => s.verified).sort().at(-1) ?? '';
  return { zones: zones.size, checked };
}
