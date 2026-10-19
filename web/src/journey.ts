// Finding a train between two places, from the 2026 timetable alone: direct trains
// first, then journeys with one change at the same station, and when a place has no
// station in the timetable, the nearest station that has one.

import type { ExploreData, ExploreTrain } from './explore';
import type { Place } from './places';

const NEAR_KM = 35; // stations this close to a district's centre count as that district's
const RAILHEAD_KM = 600; // furthest we look for a nearest station
const MIN_CHANGE_MIN = 45; // shortest sensible time to change trains
const MIN_CROSS_TOWN_MIN = 120; // changing to another station in the same city
const SAME_CITY_KM = 12;
const WIDER_KM = 150; // when a place's own stations lead nowhere, look this far
const MAX_OPTIONS = 3;
const RAILHEAD_CANDIDATES = 20;
const ROAD_MIN_PER_KM = 1.5; // to weigh a longer road trip to a better-served station
const CHANGE_LEGS_KEPT = 8; // per station, the quickest legs in and out considered for a change

// No railway line reaches these yet, so "no station" is not a gap in the data.
export const NO_RAILWAY = new Set(['Ladakh', 'Lakshadweep', 'Andaman & Nicobar Islands']);

export interface Leg {
  train: ExploreTrain;
  board: number; // stop index
  alight: number;
  dep: number; // minutes from the train's first day 00:00
  arr: number;
}

export interface Option {
  legs: Leg[];
  minutes: number; // on trains, including the wait to change
  wait?: number;
}

export interface Railhead {
  code: string;
  km: number;
  hasOwn: boolean; // the place has stations, but none with a useful train
}

export interface Journey {
  options: Option[];
  kind: 'direct' | 'change' | 'none';
  // Set when a place has no station in the timetable and the nearest one is used.
  fromRailhead?: Railhead;
  toRailhead?: Railhead;
}

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

interface Ends {
  codes: Set<string>;
  own: number; // how many of the codes are the place's own stations
  // Only when the place has no station of its own: straight-line km to each nearby one.
  roadKm?: Map<string, number>;
}

/** Stations that serve a place; `wider` adds the busier ones nearby, by road. */
export function stationsFor(place: Place, data: ExploreData, wider = false): Ends {
  const inside = new Set(place.districts);
  const codes = new Set<string>(place.station ? [place.station] : []);
  const all: [string, number][] = [];
  for (const [code, [, lon, lat, district]] of Object.entries(data.stations)) {
    const km = haversineKm(place.lon, place.lat, lon, lat);
    if (!place.station && ((district != null && inside.has(district)) || km <= NEAR_KM)) codes.add(code);
    else if (!codes.has(code)) all.push([code, km]);
  }
  if (codes.size && !wider) return { codes, own: codes.size };
  // A small halt may be nearest; a bigger station a little further on often has the trains.
  all.sort((x, y) => x[1] - y[1]);
  const limit = codes.size ? WIDER_KM : Math.min(RAILHEAD_KM, (all[0]?.[1] ?? 0) + WIDER_KM);
  const nearby = all.filter(([, km]) => km <= limit).slice(0, RAILHEAD_CANDIDATES);
  const roadKm = new Map<string, number>(nearby);
  for (const code of codes) roadKm.set(code, 0);
  return { codes: new Set([...codes, ...nearby.map(([c]) => c)]), own: codes.size, roadKm };
}

function leg(train: ExploreTrain, board: number, alight: number): Leg {
  return { train, board, alight, dep: train.stops[board][2], arr: train.stops[alight][1] };
}

function legMinutes(l: Leg): number {
  return l.arr - l.dep;
}

/** Each train's quickest ride between the two sets: board at the last stop in the first set
 * before it reaches the second. */
function directLegs(trains: ExploreTrain[], from: Set<string>, to: Set<string>): Leg[] {
  const out: Leg[] = [];
  for (const train of trains) {
    let board = -1;
    for (let i = 0; i < train.stops.length; i++) {
      const code = train.stops[i][0];
      if (from.has(code)) board = i;
      else if (board >= 0 && to.has(code)) {
        out.push(leg(train, board, i));
        break;
      }
    }
  }
  return out;
}

function best(options: Option[], cost: (o: Option) => number): Option[] {
  const seen = new Set<string>();
  return options
    .sort((a, b) => cost(a) - cost(b))
    .filter((o) => {
      const key = o.legs.map((l) => l.train.n).join('+');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_OPTIONS);
}

const hubCache = new WeakMap<ExploreData, Map<string, string>>();

/** Stations of one city share a hub, so a change can cross town (Kamakhya to Guwahati). */
function hubs(data: ExploreData): Map<string, string> {
  const cached = hubCache.get(data);
  if (cached) return cached;
  const calls = new Map<string, number>();
  for (const t of data.trains) for (const [code] of t.stops) calls.set(code, (calls.get(code) ?? 0) + 1);
  const byBusiest = Object.keys(data.stations).sort((x, y) => (calls.get(y) ?? 0) - (calls.get(x) ?? 0));
  const hub = new Map<string, string>();
  for (const code of byBusiest) {
    if (hub.has(code)) continue;
    hub.set(code, code);
    const [, lon, lat] = data.stations[code];
    for (const other of byBusiest) {
      const s = data.stations[other];
      if (!hub.has(other) && haversineKm(lon, lat, s[1], s[2]) <= SAME_CITY_KM) hub.set(other, code);
    }
  }
  hubCache.set(data, hub);
  return hub;
}

function oneChange(data: ExploreData, from: Set<string>, to: Set<string>): Option[] {
  const hub = hubs(data);
  // Every hub reachable from the start, and every hub with a train on to the end.
  const out = new Map<string, Leg[]>();
  const into = new Map<string, Leg[]>();
  const add = (map: Map<string, Leg[]>, code: string, l: Leg) => {
    const key = hub.get(code) ?? code;
    (map.get(key) ?? map.set(key, []).get(key)!).push(l);
  };
  for (const train of data.trains) {
    const codes = train.stops.map((s) => s[0]);
    // Board at the last stop in the start set before the train reaches the end set.
    const firstEnd = codes.findIndex((c) => to.has(c));
    let board = -1;
    for (let i = 0; i < (firstEnd < 0 ? codes.length : firstEnd); i++) if (from.has(codes[i])) board = i;
    if (board >= 0) {
      for (let k = board + 1; k < codes.length && !from.has(codes[k]) && !to.has(codes[k]); k++) {
        add(out, codes[k], leg(train, board, k));
      }
    }
    if (firstEnd > 0) {
      for (let k = firstEnd - 1; k >= 0 && !to.has(codes[k]) && !from.has(codes[k]); k--) {
        add(into, codes[k], leg(train, k, firstEnd));
      }
    }
  }
  const quickest = (legs: Leg[]) =>
    legs.sort((x, y) => legMinutes(x) - legMinutes(y)).slice(0, CHANGE_LEGS_KEPT);
  const options: Option[] = [];
  for (const [key, firsts] of out) {
    const seconds = into.get(key);
    if (!seconds) continue;
    for (const a of quickest(firsts)) {
      for (const b of quickest(seconds)) {
        if (a.train === b.train) continue;
        const sameStation = a.train.stops[a.alight][0] === b.train.stops[b.board][0];
        const least = sameStation ? MIN_CHANGE_MIN : MIN_CROSS_TOWN_MIN;
        let wait = (((b.dep - a.arr) % 1440) + 1440) % 1440;
        if (wait < least) wait += 1440;
        options.push({ legs: [a, b], wait, minutes: legMinutes(a) + wait + legMinutes(b) });
      }
    }
  }
  return options;
}

function search(data: ExploreData, start: Ends, end: Ends): Journey {
  if (!start.codes.size || !end.codes.size) return { options: [], kind: 'none' };
  const first = (o: Option) => o.legs[0].train.stops[o.legs[0].board][0];
  const last = (o: Option) => {
    const l = o.legs[o.legs.length - 1];
    return l.train.stops[l.alight][0];
  };
  const road = (o: Option) => (start.roadKm?.get(first(o)) ?? 0) + (end.roadKm?.get(last(o)) ?? 0);
  const cost = (o: Option) => o.minutes + ROAD_MIN_PER_KM * road(o);

  const direct = directLegs(data.trains, start.codes, end.codes).map((l) => ({ legs: [l], minutes: legMinutes(l) }));
  const options = best(direct.length ? direct : oneChange(data, start.codes, end.codes), cost);
  const kind = !options.length ? 'none' : direct.length ? 'direct' : 'change';
  // Name the station actually used when it is not in the place itself.
  const railhead = (ends: Ends, code: string | undefined): Railhead | undefined => {
    const km = code === undefined ? undefined : ends.roadKm?.get(code);
    return km ? { code: code!, km: Math.round(km), hasOwn: ends.own > 0 } : undefined;
  };
  return {
    options,
    kind,
    fromRailhead: railhead(start, options[0] && first(options[0])),
    toRailhead: railhead(end, options[0] && last(options[0])),
  };
}

export function findJourney(from: Place, to: Place, data: ExploreData): Journey {
  const journey = search(data, stationsFor(from, data), stationsFor(to, data));
  if (journey.kind !== 'none') return journey;
  // The place's own stations lead nowhere useful (a hill line, a new branch): try nearby ones.
  return search(data, stationsFor(from, data, true), stationsFor(to, data, true));
}

/** Rail distance for part of a train's run: its share of the straight-line route, scaled to
 * the train's estimated rail distance. */
export function legKm(l: Leg, data: ExploreData): number {
  const point = (i: number) => data.stations[l.train.stops[i][0]];
  let part = 0;
  let whole = 0;
  for (let i = 1; i < l.train.stops.length; i++) {
    const [a, b] = [point(i - 1), point(i)];
    if (!a || !b) continue;
    const km = haversineKm(a[1], a[2], b[1], b[2]);
    whole += km;
    if (i > l.board && i <= l.alight) part += km;
  }
  return whole ? (l.train.km * part) / whole : l.train.km;
}

/** The stops a leg passes through, as map coordinates. */
export function legPath(l: Leg, data: ExploreData): [number, number][] {
  return l.train.stops
    .slice(l.board, l.alight + 1)
    .map((s) => data.stations[s[0]])
    .filter(Boolean)
    .map((s) => [s[1], s[2]]);
}
