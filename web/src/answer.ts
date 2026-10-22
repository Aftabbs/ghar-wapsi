// What we tell someone who searched From -> To: the train, the fare, special trains
// this season, and how many people make the same move. Pure, so every line is tested.

import type { Migration, RailTravel } from './card';
import { CLASS_NAMES, clock, type ExploreData, fareRanges, type FareData, hours, trainLabel } from './explore';
import type { Special } from './festival';
import { findJourney, haversineKm, type Journey, legKm, NO_RAILWAY, type Option, weekday } from './journey';
import { type Place, spoken } from './places';

export const TIMETABLE = 'Trains at a Glance 2026';
const NEAR_SPECIAL_KM = 35;
const CARD_CLASSES = ['SL', '3A', '2A', 'CC'];

export interface Step {
  train: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
  duration: string;
  days: string;
  when?: string; // "Thu 30 Oct" when a date was chosen
}

export interface Fact {
  text: string;
  source: string;
}

export interface Answer {
  title: string;
  headline: string;
  steps: Step[];
  wait?: string; // time to change trains
  notes: string[]; // nearest-station and no-railway explanations
  fares: { cls: string; low: number; high: number }[];
  alternatives: string[];
  specials: Special[];
  season: string | null;
  people: Fact[]; // how many make the same move
  facts: Fact[]; // everything for the card, each with its source
  journey: Journey;
}

export interface Context {
  explore: ExploreData;
  fares: FareData;
  specials: Special[];
  migration: Migration;
  travel: RailTravel;
  today: string; // YYYY-MM-DD; specials that have stopped running are left out
  date?: string; // YYYY-MM-DD the traveller wants to leave, if they chose one
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu 30 Oct" for a YYYY-MM-DD date moved by whole days. */
export function dayLabel(date: string, plusDays = 0): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return `${weekday(date, plusDays)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function stationName(code: string, data: ExploreData): string {
  return data.stations[code]?.[0] ?? code;
}

function days(list: string[]): string {
  if (!list.length || list.includes('Daily')) return list.length ? 'Daily' : 'Days not listed';
  return `Runs ${list.join(', ')}`;
}

function steps(option: Option, data: ExploreData, date?: string): Step[] {
  let boardDay = 0; // days after the chosen date that each leg leaves
  return option.legs.map((l, i) => {
    const day = Math.floor(l.arr / 1440) - Math.floor(l.dep / 1440);
    if (i > 0) {
      const a = option.legs[0];
      boardDay = Math.floor(((a.dep % 1440) + (a.arr - a.dep) + (option.wait ?? 0)) / 1440);
    }
    return {
      when: date ? dayLabel(date, boardDay) : undefined,
      train: trainLabel(l.train),
      from: stationName(l.train.stops[l.board][0], data),
      to: stationName(l.train.stops[l.alight][0], data),
      dep: clock(l.dep),
      arr: `${clock(l.arr)}${day > 0 ? ` (+${day} day${day > 1 ? 's' : ''})` : ''}`,
      duration: hours(l.arr - l.dep),
      days: days(l.train.days),
    };
  });
}

/** Fare range for the whole trip: a class counts only if every leg has it. */
export function tripFares(option: Option, ctx: Pick<Context, 'explore' | 'fares'>) {
  const perLeg = option.legs.map((l) => fareRanges(l.train, ctx.fares, legKm(l, ctx.explore)));
  if (perLeg.some((f) => !f.length)) return [];
  return perLeg[0]
    .filter((f) => perLeg.every((leg) => leg.some((x) => x.cls === f.cls)))
    .map((f) => ({
      cls: f.cls,
      low: perLeg.reduce((s, leg) => s + leg.find((x) => x.cls === f.cls)!.low, 0),
      high: perLeg.reduce((s, leg) => s + leg.find((x) => x.cls === f.cls)!.high, 0),
    }));
}

function near(place: Place, district: number | null, at: [number, number]): boolean {
  return (district != null && place.districts.includes(district)) || haversineKm(place.lon, place.lat, ...at) <= NEAR_SPECIAL_KM;
}

/** Does a special leave on this date? Dates in its notice, then its weekdays. */
function specialRunsOn(s: Special, date: string): boolean {
  if ((s.first && date < s.first) || (s.last && date > s.last)) return false;
  const named = s.days.filter((d) => d !== 'Daily' && d !== 'Specific dates');
  return !named.length || s.days.includes('Daily') || named.includes(weekday(date));
}

/** Special trains from near `from` to `to`'s state: still running, or running on the date. */
export function specialsFor(from: Place, to: Place, ctx: Pick<Context, 'specials' | 'today' | 'date'>): Special[] {
  const states = new Set([to.state, to.state2011]);
  return ctx.specials.filter(
    (s) =>
      (ctx.date ? specialRunsOn(s, ctx.date) : !s.last || s.last >= ctx.today) &&
      near(from, s.oDistrict, s.from) &&
      (states.has(s.dState ?? '') || near(to, s.dDistrict, s.to)),
  );
}

function notes(journey: Journey, from: Place, to: Place, data: ExploreData): string[] {
  const out: string[] = [];
  for (const [place, railhead] of [
    [from, journey.fromRailhead],
    [to, journey.toRailhead],
  ] as const) {
    if (!railhead) continue;
    const station = `${stationName(railhead.code, data)} (${railhead.code}), about ${railhead.km.toLocaleString('en-IN')} km away in a straight line`;
    let note = `No station in ${place.name} is in the main timetable. The nearest useful one is ${station}.`;
    if (place.localStation) {
      note = `${place.name} station is not a main stop in the official timetable, so this uses ${station}. Some trains may stop at ${place.name} too: check on NTES or IRCTC.`;
    }
    if (NO_RAILWAY.has(place.state)) note = `There is no railway in ${spoken(place.state)} yet. The nearest station is ${station}.`;
    else if (railhead.hasOwn) note = `Trains from ${place.name} itself do not connect well. The quickest way is from ${station}.`;
    out.push(note);
  }
  return out;
}

function headline(journey: Journey, from: Place, to: Place, data: ExploreData): string {
  const on = journey.date ? ` on ${dayLabel(journey.date)}` : '';
  if (journey.dateMiss) {
    return `No train runs${on}. These run on other days`;
  }
  if (journey.kind === 'direct' && on) return `Fastest direct train${on}`;
  if (journey.kind === 'direct') return journey.options.length > 1 ? 'Fastest direct train' : 'Direct train';
  if (journey.kind === 'change') {
    const at = journey.options[0].legs[0].train.stops[journey.options[0].legs[0].alight][0];
    return `No direct train${on}. Quickest with one change, at ${stationName(at, data)}`;
  }
  return `No train in ${TIMETABLE} links ${from.name} and ${to.name} directly or with one change.`;
}

function peopleFacts(from: Place, to: Place, ctx: Context): Fact[] {
  const out: Fact[] = [];
  if (to.state !== from.state) {
    const share = ctx.travel.shares[to.state]?.[from.state];
    if (share !== undefined && share >= 0.1) {
      out.push({
        text: `${share.toFixed(1)}% of long-distance unreserved train trips from ${spoken(to.state)} in ${ctx.travel.year} went to ${spoken(from.state)}`,
        source: 'EAC-PM migration study, railway ticket data',
      });
    }
  }
  if (to.state2011 !== from.state2011) {
    const people = from.districts.reduce(
      (sum, d) => sum + (ctx.migration.districts[String(d)]?.from[to.state2011] ?? 0),
      0,
    );
    if (people > 0) {
      const origin = to.state2011 === to.state ? spoken(to.state) : `undivided ${to.state2011}`;
      out.push({
        text: `${people.toLocaleString('en-IN')} people from ${origin} lived in ${from.kind === 'station' || from.kind === 'town' ? `${from.name}'s district` : from.name}`,
        source: 'Census 2011, the latest count; Census 2027 results are pending',
      });
    }
  }
  return out;
}

export function answer(from: Place, to: Place, ctx: Context): Answer {
  const journey = findJourney(from, to, ctx.explore, ctx.date);
  const first = journey.options[0];
  const fares = first ? tripFares(first, ctx) : [];
  const specials = specialsFor(from, to, ctx);
  const season = specials[0]?.season ?? null;
  const out: Answer = {
    title: `${from.name} → ${to.name}${ctx.date ? `, ${dayLabel(ctx.date)}` : ''}`,
    headline: headline(journey, from, to, ctx.explore),
    steps: first ? steps(first, ctx.explore, journey.dateMiss ? undefined : ctx.date) : [],
    wait: first?.wait !== undefined ? hours(first.wait) : undefined,
    notes: notes(journey, from, to, ctx.explore),
    fares,
    alternatives: journey.options.slice(1).map((o) => `${o.legs.map((l) => trainLabel(l.train)).join(' + ')} · ${hours(o.minutes)}`),
    specials,
    season,
    people: peopleFacts(from, to, ctx),
    facts: [],
    journey,
  };

  if (first) {
    const s = out.steps;
    out.facts.push({
      text:
        s.length === 1
          ? `${s[0].train}: ${s[0].dep} → ${s[0].arr}, ${s[0].duration}`
          : `${s.map((x) => x.train).join(', then ')}, ${hours(first.minutes)} with the change`,
      source: TIMETABLE,
    });
  } else {
    out.facts.push({ text: out.headline, source: TIMETABLE });
  }
  const cardFares = fares.filter((f) => CARD_CLASSES.includes(f.cls)).slice(0, 2);
  if (cardFares.length) {
    out.facts.push({
      text: cardFares.map((f) => `${CLASS_NAMES[f.cls]} ${rupees(f.low)}${f.high > f.low ? `–${rupees(f.high).slice(1)}` : ''}`).join(' · '),
      source: 'estimated from the official fare tables; check IRCTC',
    });
  }
  if (specials.length) {
    out.facts.push({
      text: `${specials.length} special train${specials.length > 1 ? 's' : ''} to ${spoken(to.state)} ${ctx.date ? `on ${dayLabel(ctx.date)}` : 'this season'}`,
      source: `${season}, official railway notices`,
    });
  }
  out.facts.push(...out.people);
  return out;
}
