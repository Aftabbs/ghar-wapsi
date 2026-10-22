// Places people can search for: districts (under today's names), the big cities that
// span several districts, and every station in the timetable.

import type { ExploreData } from './explore';

export interface Places {
  cities: Record<string, { name: string; districts: number[]; aliases?: string[] }>;
  // code -> name today, Census 2011 state, lon, lat, state today, other names
  districts: Record<string, [string, string, number, number, string, string[]]>;
}

export interface Place {
  label: string; // unique; what the search box shows
  kind: 'city' | 'district' | 'station' | 'town'; // town: a town or a station off the main timetable
  name: string;
  state: string; // today's state
  state2011: string; // for the Census counts
  districts: number[];
  station?: string; // station code, for a station in the timetable
  localStation?: string; // a town's own station when the timetable does not list it
  rank?: number; // towns: 0 city ... 4 village, to order equal matches
  lon: number;
  lat: number;
  terms: string[]; // normalised names to match a search against
  key: string; // the normalised label
}

export function spoken(state: string | null | undefined): string {
  return state === 'NCT of Delhi' ? 'Delhi' : state ?? '';
}

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // drop accents: "Kadūr" is "kadur", as in the pipeline
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPlaces(places: Places, explore: ExploreData): Place[] {
  const out: Omit<Place, 'key'>[] = [];
  for (const city of Object.values(places.cities)) {
    const parts = city.districts.map((d) => places.districts[String(d)]).filter(Boolean);
    const [, state2011, , , state] = parts[0];
    out.push({
      label: `${city.name} (whole city)`,
      kind: 'city',
      name: city.name,
      state,
      state2011,
      districts: city.districts,
      lon: parts.reduce((s, p) => s + p[2], 0) / parts.length,
      lat: parts.reduce((s, p) => s + p[3], 0) / parts.length,
      terms: [city.name, ...(city.aliases ?? [])].map(normalise),
    });
  }
  for (const [code, [name, state2011, lon, lat, state, aliases]] of Object.entries(places.districts)) {
    out.push({
      label: `${name}, ${spoken(state)}`,
      kind: 'district',
      name,
      state,
      state2011,
      districts: [Number(code)],
      lon,
      lat,
      terms: [name, ...aliases].map(normalise),
    });
  }
  for (const [code, [name, lon, lat, district]] of Object.entries(explore.stations)) {
    const home = district == null ? undefined : places.districts[String(district)];
    if (!home) continue;
    out.push({
      label: `${name} station (${code})`,
      kind: 'station',
      name,
      state: home[4],
      state2011: home[1],
      districts: [district!],
      station: code,
      lon,
      lat,
      terms: [normalise(name), code.toLowerCase()],
    });
  }
  // Normalised once here, not on every keystroke.
  return out.map((p) => ({ ...p, key: normalise(p.label) }));
}

const KIND_ORDER = { city: 0, district: 1, station: 2, town: 3 };

/** Best matches for what someone typed: exact names first, then prefixes, then words. */
export function searchPlaces(query: string, places: Place[], limit = 8): Place[] {
  const q = normalise(query);
  if (!q) return [];
  const scored: { place: Place; score: number }[] = [];
  for (const place of places) {
    if (place.key === q) return [place];
    let score = place.key.startsWith(q) ? 1 : Infinity;
    for (const term of place.terms) {
      if (term === q) score = Math.min(score, 0);
      else if (term.startsWith(q)) score = Math.min(score, 1);
      else if (term.split(' ').some((w) => w.startsWith(q))) score = Math.min(score, 2);
      else if (term.includes(q)) score = Math.min(score, 3);
    }
    if (score < Infinity) scored.push({ place, score: score * 3 + KIND_ORDER[place.kind] });
  }
  return scored
    // Ties: the shorter name is the closer match ("Bengaluru" before "Bengaluru Rural").
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.place.rank ?? 0) - (b.place.rank ?? 0) ||
        a.place.name.length - b.place.name.length ||
        a.place.label.localeCompare(b.place.label),
    )
    .slice(0, limit)
    .map((s) => s.place);
}
