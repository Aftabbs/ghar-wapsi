// Towns, villages and small stations (from GeoNames and the station list), split into
// small files by the first letters of the name; only the file for what is typed is fetched.

import { normalise, type Place, type Places, spoken } from './places';

// name, lon, lat, Census district code, station code or "", rank (0 city ... 4 village)
type Row = [string, number, number, number, string, number];

let index: Promise<string[]> | null = null;
const files = new Map<string, Promise<Place[]>>();

function letters(text: string): string {
  return normalise(text).replace(/[^a-z0-9]/g, '');
}

function toPlaces(rows: Row[], places: Places): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const [name, lon, lat, district, code, rank] of rows) {
    const home = places.districts[String(district)];
    if (!home) continue;
    let label = `${name}, ${home[0]}, ${spoken(home[4])}`;
    // Two villages with one name in one district: tell them apart by their position.
    if (seen.has(label)) label = `${name}, ${home[0]}, ${spoken(home[4])} (${lat.toFixed(2)}°N ${lon.toFixed(2)}°E)`;
    seen.add(label);
    out.push({
      label,
      key: normalise(label),
      kind: 'town',
      name,
      state: home[4],
      state2011: home[1],
      districts: [district],
      localStation: code || undefined,
      rank,
      lon,
      lat,
      terms: [normalise(name), ...(code ? [code.toLowerCase()] : [])],
    });
  }
  return out;
}

/**
 * Towns whose names could match what was typed. Empty until enough letters are typed to
 * pick one file (two for most names, more for busy ones like "ka...").
 */
export async function townsFor(text: string, dataUrl: string, places: Places): Promise<Place[]> {
  const typed = letters(text);
  if (typed.length < 2) return [];
  index ??= fetch(`${dataUrl}towns/index.json`).then((r) => r.json());
  let prefixes: string[];
  try {
    prefixes = await index;
  } catch {
    index = null; // retry on the next keystroke
    return [];
  }
  // "kad" for Kadur; a padded file such as "ka_" holds names that are only those letters.
  const fits = (p: string) => (p.includes('_') ? typed === p.replace(/_+$/, '') : typed.startsWith(p));
  const prefix = prefixes.filter(fits).sort((a, b) => b.length - a.length)[0];
  if (!prefix) return [];
  let file = files.get(prefix);
  if (!file) {
    file = fetch(`${dataUrl}towns/${prefix}.json`)
      .then((r) => r.json() as Promise<Row[]>)
      .then((rows) => toPlaces(rows, places));
    file.catch(() => files.delete(prefix));
    files.set(prefix, file);
  }
  return file.catch(() => []);
}
