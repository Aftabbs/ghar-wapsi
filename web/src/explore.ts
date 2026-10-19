// Explore mode: what the info panel says about a tapped train, station, district or state.
// Pure functions over the published data, so every line can be traced and tested.

import type { Migration, RailTravel } from './card';
import type { Places } from './places';
import { isHomeward, type Special } from './festival';

export interface ExploreTrain {
  n: string;
  name: string;
  days: string[];
  classes: string[];
  km: number; // estimated rail distance
  stops: [string, number, number][]; // station code, arrival minute, departure minute
}

export interface ExploreData {
  trains: ExploreTrain[];
  // code -> name, lon, lat, Census 2011 district code, district, state
  stations: Record<string, [string, number, number, number | null, string | null, string | null]>;
}

export interface FareData {
  tables: Record<string, { columns: string[]; from_km: number; slabs: number[][] }>;
  charges: Record<string, { min_km: number; reservation: number; superfast: number }>;
  revision_paise_per_km: number;
  ac_classes: string[];
  gst: number;
  vande_bharat_multiplier: Record<string, number>;
}

export interface Panel {
  kind: 'train' | 'station' | 'district' | 'state';
  title: string;
  subtitle: string;
  rows: { label: string; value: string }[];
  list?: { heading: string; items: string[] };
  note?: string;
  links?: { text: string; href: string }[];
  source: string;
}

export const CLASS_NAMES: Record<string, string> = {
  '1A': 'First AC',
  '2A': 'AC 2-tier',
  '3A': 'AC 3-tier',
  '3E': 'AC 3 economy',
  CC: 'AC chair car',
  EC: 'Executive chair car',
  SL: 'Sleeper',
  '2S': 'Second sitting',
  II: 'General',
  FC: 'First class',
  EV: 'Vistadome',
  P: 'Pantry car',
};
const FARE_ORDER = ['SL', '3E', '3A', '2A', '1A', 'CC', 'EC'];
const DISTANCE_ERROR = 0.06; // 80% of trains are within this of the official distance
const TIMETABLE = 'Trains at a Glance 2026, Ministry of Railways';

export function clock(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function dayNote(minute: number, start: number): string {
  const day = Math.floor(minute / 1440) - Math.floor(start / 1440);
  return day > 0 ? ` (day ${day + 1})` : '';
}

export function hours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "12627 Karnataka Express", or just the number when the timetable prints no name. */
export function trainLabel(train: ExploreTrain): string {
  return train.name && train.name !== train.n ? `${train.n} ${train.name}` : train.n;
}

function spoken(state: string | null | undefined): string {
  return state === 'NCT of Delhi' ? 'Delhi' : state ?? '';
}

// ---- fares ------------------------------------------------------------------

export function fareCategory(name: string): { category: string; multiplier?: Record<string, number> } | null {
  const n = name.toLowerCase();
  if (n.includes('vande bharat') && n.includes('sleeper')) return null; // own fare rules
  if (n.includes('rajdhani')) return { category: 'rajdhani' };
  if (n.includes('duronto')) return { category: 'duronto' };
  if (n.includes('vande bharat')) return { category: 'shatabdi', multiplier: { CC: 1.4, EC: 1.3 } };
  if (n.includes('shatabdi') && !n.includes('jan shatabdi')) return { category: 'shatabdi' };
  if (n.includes('humsafar')) return { category: 'humsafar' };
  if (n.includes('garib rath')) return { category: 'garib_rath' };
  if (/jan shatabdi|amrit bharat|antyodaya|tejas|gatimaan|mahamana|namo bharat/.test(n)) return null;
  return { category: 'mail_express' };
}

function oneFare(data: FareData, category: string, cls: string, km: number, superfast: boolean, mult = 1): number | null {
  const resolved = category === 'mail_express' ? (cls === 'SL' || cls === '2S' || cls === 'FC' ? 'mail_express_nonac' : 'mail_express_ac') : category;
  const table = data.tables[resolved];
  const charges = data.charges[cls];
  if (!table || !charges || !table.columns.includes(cls)) return null;
  const charged = Math.max(km, charges.min_km);
  if (charged < table.from_km) return null;
  const row = table.slabs.find((r) => charged <= r[0]);
  if (!row) return null;
  let amount = row[table.columns.indexOf(cls) + 1] * mult + Math.round((data.revision_paise_per_km * charged) / 100);
  amount += charges.reservation + (superfast ? charges.superfast : 0);
  const premium = ['rajdhani', 'duronto', 'shatabdi'].includes(resolved);
  if (data.ac_classes.includes(cls) || premium) amount *= 1 + data.gst;
  return Math.ceil(amount / 5) * 5;
}

/** Estimated fare range per class: the distance is an estimate, and superfast status is
 * known only from the train number, so the range spans both. `km` is the part ridden. */
export function fareRanges(
  train: ExploreTrain,
  data: FareData,
  km = train.km,
): { cls: string; low: number; high: number }[] {
  const cat = fareCategory(train.name);
  if (!cat) return [];
  const likelySuperfast = /^(12|20|22)/.test(train.n);
  const out = [];
  for (const cls of FARE_ORDER) {
    if (!train.classes.includes(cls)) continue;
    const mult = cat.multiplier?.[cls] ?? 1;
    const low = oneFare(data, cat.category, cls, km * (1 - DISTANCE_ERROR), likelySuperfast, mult);
    const high = oneFare(data, cat.category, cls, km * (1 + DISTANCE_ERROR), true, mult);
    if (low != null && high != null) out.push({ cls, low, high });
  }
  return out;
}

// ---- panels -------------------------------------------------------------------

export function trainPanel(train: ExploreTrain, data: ExploreData, fares: FareData | null): Panel {
  const station = (code: string) => data.stations[code];
  const [firstCode, , firstDep] = train.stops[0];
  const [lastCode, lastArr] = train.stops[train.stops.length - 1];
  const origin = station(firstCode);
  const dest = station(lastCode);
  const states = [...new Set(train.stops.map((s) => station(s[0])?.[5]).filter(Boolean))];

  // Other trains between the same two districts: is this one the quickest?
  const fromDistrict = origin?.[3];
  const toDistrict = dest?.[3];
  const peers = data.trains.filter((t) => {
    const codes = t.stops.map((s) => s[0]);
    const i = codes.findIndex((c) => station(c)?.[3] === fromDistrict);
    const j = codes.findIndex((c, k) => k > i && station(c)?.[3] === toDistrict);
    return i >= 0 && j > i;
  });
  const duration = lastArr - firstDep;
  const quickest = peers.every((t) => {
    const codes = t.stops.map((s) => s[0]);
    const i = codes.findIndex((c) => station(c)?.[3] === fromDistrict);
    const j = codes.findIndex((c, k) => k > i && station(c)?.[3] === toDistrict);
    return t.stops[j][1] - t.stops[i][2] >= duration - 1;
  });

  const rows = [
    { label: 'Leaves', value: `${origin?.[0] ?? firstCode} (${firstCode}) at ${clock(firstDep)}` },
    { label: 'Arrives', value: `${dest?.[0] ?? lastCode} (${lastCode}) at ${clock(lastArr)}${dayNote(lastArr, firstDep)}` },
    { label: 'Journey', value: `${hours(duration)} · about ${train.km.toLocaleString('en-IN')} km` },
    { label: 'Runs', value: train.days.length ? train.days.join(', ') : 'Not listed' },
  ];
  if (train.classes.length) {
    rows.push({ label: 'Classes', value: train.classes.map((c) => CLASS_NAMES[c] ?? c).join(' · ') });
  }
  const ranges = fares ? fareRanges(train, fares) : [];
  if (ranges.length) {
    rows.push({
      label: 'Fare (estimate)',
      value: ranges.map((r) => `${CLASS_NAMES[r.cls]} ₹${r.low.toLocaleString('en-IN')}–${r.high.toLocaleString('en-IN')}`).join(' · '),
    });
  }
  const fact =
    peers.length > 1
      ? `1 of ${peers.length} trains between ${origin?.[4]} and ${dest?.[4]} districts${quickest ? ', and the quickest' : ''}. Crosses ${states.length} state${states.length === 1 ? '' : 's'}.`
      : `Crosses ${states.length} state${states.length === 1 ? '' : 's'}.`;
  return {
    kind: 'train',
    title: trainLabel(train),
    subtitle: `${spoken(origin?.[5])} → ${spoken(dest?.[5])}`,
    rows,
    list: {
      heading: `${train.stops.length} main stops`,
      items: train.stops.map(([code, arr, dep], i) => {
        const time = i === 0 ? clock(dep) : clock(arr);
        return `${time} ${station(code)?.[0] ?? code}`;
      }),
    },
    note: `${fact} Fares are estimated from the official fare table for the estimated distance; they leave out meals, Tatkal and demand-based pricing.`,
    links: [{ text: 'Check fares and book on IRCTC', href: 'https://www.irctc.co.in/' }],
    source: `${TIMETABLE}; fare tables w.e.f. 01.07.2025 with the Dec 2025 revision`,
  };
}

export function stationPanel(code: string, data: ExploreData, specials: Special[], minute: number): Panel {
  const [name, , , , district, state] = data.stations[code];
  const calls = data.trains
    .map((t) => ({ t, stop: t.stops.find((s) => s[0] === code) }))
    .filter((x): x is { t: ExploreTrain; stop: [string, number, number] } => !!x.stop);
  const now = ((minute % 1440) + 1440) % 1440;
  const upcoming = calls
    .filter((x) => x.stop[0] !== x.t.stops[x.t.stops.length - 1][0])
    .map((x) => ({ ...x, at: ((x.stop[2] % 1440) - now + 1440) % 1440 }))
    .sort((a, b) => a.at - b.at)
    .slice(0, 5);
  const fromHere = specials.filter((s) => s.o === code).length;
  const toHere = specials.filter((s) => s.d === code).length;
  const rows = [
    { label: 'Where', value: `${district ?? '—'} district, ${spoken(state)}` },
    { label: 'Trains', value: `${calls.length} trains in the timetable stop here` },
  ];
  if (fromHere || toHere) {
    rows.push({ label: 'Special trains this season', value: `${fromHere} start here · ${toHere} end here (verified)` });
  }
  return {
    kind: 'station',
    title: `${name} (${code})`,
    subtitle: 'Railway station',
    rows,
    list: {
      heading: `Next departures after ${clock(now)} on the map clock`,
      items: upcoming.map((x) => {
        const last = x.t.stops[x.t.stops.length - 1][0];
        return `${clock(x.stop[2])} ${trainLabel(x.t)} to ${data.stations[last]?.[0] ?? last}`;
      }),
    },
    source: TIMETABLE,
  };
}

export function districtPanel(
  code: string,
  places: Places,
  migration: Migration,
  data: ExploreData,
): Panel {
  const [name, state2011, , , state] = places.districts[code];
  const stations = Object.entries(data.stations).filter(([, s]) => String(s[3]) === code);
  const busiest = stations
    .map(([c, s]) => ({ name: s[0], code: c, trains: data.trains.filter((t) => t.stops.some((x) => x[0] === c)).length }))
    .sort((a, b) => b.trains - a.trains)
    .slice(0, 3);
  const from = Object.entries(migration.districts[code]?.from ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const rows = [{ label: 'State', value: spoken(state) }];
  if (busiest.length) {
    rows.push({ label: 'Busiest stations', value: busiest.map((b) => `${b.name} (${b.trains} trains)`).join(' · ') });
  }
  if (from.length) {
    rows.push({
      label: 'Came from (2011)',
      value: from.map(([s, n]) => `${spoken(s)} ${n.toLocaleString('en-IN')}`).join(' · '),
    });
  }
  return {
    kind: 'district',
    title: name,
    subtitle: `District${state2011 !== state ? ` (counted under ${state2011} in 2011)` : ''}`,
    rows,
    note: 'People living here whose previous home was in another state, by state, from Census 2011, the latest count.',
    source: `${TIMETABLE}; Census of India 2011, Table D-02`,
  };
}

export function statePanel(state: string, travel: RailTravel, specials: Special[], migration: Migration): Panel {
  const shares = Object.entries(travel.shares[state] ?? {})
    .filter(([s]) => s !== state)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const inbound = specials.filter((s) => isHomeward(s) && s.dState === state).length;
  const census = state === 'Telangana' ? 'Andhra Pradesh' : state;
  const residents = Object.entries(migration.districts)
    .filter(([, d]) => d.state === census)
    .reduce<Record<string, number>>((acc, [, d]) => {
      for (const [s, n] of Object.entries(d.from)) acc[s] = (acc[s] ?? 0) + n;
      return acc;
    }, {});
  const top = Object.entries(residents).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const rows = [];
  if (shares.length) {
    rows.push({
      label: 'Train trips went to (2023)',
      value: shares.map(([s, p]) => `${spoken(s)} ${p.toFixed(1)}%`).join(' · '),
    });
  }
  rows.push({ label: 'Special trains this season', value: `${inbound} verified specials from the big cities` });
  if (top.length) {
    rows.push({ label: 'Newcomers came from (2011)', value: top.map(([s, n]) => `${spoken(s)} ${n.toLocaleString('en-IN')}`).join(' · ') });
  }
  return {
    kind: 'state',
    title: spoken(state),
    subtitle: 'State',
    rows,
    note: 'Trip shares are of unreserved long-distance rail trips leaving the state in 2023 (EAC-PM). Newcomer counts are Census 2011, the latest count.',
    source: 'EAC-PM migration study; Census of India 2011; zonal railway notices',
  };
}
