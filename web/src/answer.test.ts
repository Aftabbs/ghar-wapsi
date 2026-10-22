import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { answer, type Context, dayLabel, specialsFor } from './answer';
import type { ExploreData } from './explore';
import type { Special } from './festival';
import { findJourney, haversineKm, runsOn, weekday } from './journey';
import { buildPlaces, type Place, type Places, searchPlaces } from './places';

const load = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/${name}`, import.meta.url)), 'utf8'));
const explore: ExploreData = load('explore.json');
const places: Place[] = buildPlaces(load('places.json') as Places, explore);
const specials: Special[] = load('specials-2026.json');
const ctx: Context = {
  explore,
  fares: load('fares.json'),
  specials,
  migration: load('migration-2011.json'),
  travel: load('rail-travel-2023.json'),
  today: '2026-10-19',
};
const place = (q: string) => searchPlaces(q, places, 1)[0];

describe('search', () => {
  it('finds places by the names people use today and the old ones', () => {
    expect(place('Bangalore').label).toBe('Bengaluru, Karnataka');
    expect(place('gurgaon').label).toBe('Gurugram, Haryana');
    expect(place('Delhi').label).toBe('Delhi (whole city)');
    expect(place('Leh').label).toBe('Leh, Ladakh');
    expect(place('PNBE').kind).toBe('station');
  });

  it('lists Ladakh as its own union territory', () => {
    expect(places.filter((p) => p.kind === 'district' && p.state === 'Ladakh').map((p) => p.name).sort()).toEqual([
      'Kargil',
      'Leh',
    ]);
  });
});

describe('journeys', () => {
  it('finds the fastest direct train', () => {
    const journey = findJourney(place('Bengaluru'), place('Patna, Bihar'), explore);
    expect(journey.kind).toBe('direct');
    const minutes = journey.options.map((o) => o.minutes);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
    for (const o of journey.options) {
      const [leg] = o.legs;
      expect(leg.alight).toBeGreaterThan(leg.board);
      expect(o.minutes).toBe(leg.arr - leg.dep);
    }
  });

  it('explains that Ladakh has no railway and uses the nearest station', () => {
    const a = answer(place('Delhi'), place('Leh'), ctx);
    expect(a.notes[0]).toMatch(/^There is no railway in Ladakh yet\. The nearest station is .+ km away/);
    expect(a.journey.toRailhead).toBeDefined();
    expect(a.steps.length).toBeGreaterThan(0);
  });

  it('falls back to one change when no train runs direct', () => {
    const journey = findJourney(place('Bengaluru'), place('Srinagar'), explore);
    expect(journey.kind).toBe('change');
    const [first, second] = journey.options[0].legs;
    const at = explore.stations[first.train.stops[first.alight][0]];
    const on = explore.stations[second.train.stops[second.board][0]];
    expect(haversineKm(at[1], at[2], on[1], on[2])).toBeLessThanOrEqual(12); // same station or same town
    expect(journey.options[0].wait).toBeGreaterThanOrEqual(45);
    expect(journey.options[0].minutes).toBe(
      first.arr - first.dep + journey.options[0].wait! + second.arr - second.dep,
    );
  });

  it('uses busier stations nearby when a place has none in the timetable', () => {
    const journey = findJourney(place('Bengaluru'), place('Gangtok'), explore);
    expect(journey.kind).toBe('direct');
    expect(journey.toRailhead!.km).toBeLessThan(150);
  });
});

describe('answers', () => {
  it('gives fares, specials still running, and the people figures', () => {
    const a = answer(place('Bengaluru'), place('Patna, Bihar'), ctx);
    expect(a.fares.find((f) => f.cls === 'SL')!.low).toBeGreaterThan(500);
    expect(a.people.map((f) => f.source)).toEqual([
      'EAC-PM migration study, railway ticket data',
      'Census 2011, the latest count; Census 2027 results are pending',
    ]);
    expect(a.facts.every((f) => f.source.length > 0)).toBe(true);
  });

  it('leaves out special trains that have stopped running', () => {
    const from = place('Bengaluru');
    const to = place('Patna, Bihar');
    const now = specialsFor(from, to, ctx);
    const later = specialsFor(from, to, { ...ctx, today: '2027-06-01' });
    expect(now.length).toBeGreaterThan(0);
    expect(later).toEqual([]);
  });
});

describe('dates', () => {
  it('names weekdays and dates', () => {
    expect(weekday('2026-10-30')).toBe('Fri');
    expect(weekday('2026-10-30', 3)).toBe('Mon');
    expect(dayLabel('2026-10-31')).toBe('Sat 31 Oct');
  });

  it('counts days from where the train starts', () => {
    const weekly = explore.trains.find((t) => t.days.length === 1 && t.days[0] !== 'Daily' && t.stops.some((s) => s[2] >= 1440))!;
    const later = weekly.stops.findIndex((s) => s[2] >= 1440); // reached a day after it left
    const start = '2026-11-02'; // a Monday; find the first date this train starts
    let first = start;
    for (let i = 0; i < 7 && weekday(first) !== weekly.days[0]; i++) first = new Date(Date.parse(first) + 86400000).toISOString().slice(0, 10);
    expect(runsOn(weekly, 0, first)).toBe(true);
    expect(runsOn(weekly, later, first)).toBe(false);
    expect(runsOn(weekly, later, first, 1)).toBe(true);
  });

  it('keeps only trains that leave on the chosen day, or says nothing runs then', () => {
    const from = place('Bengaluru');
    const to = place('Patna, Bihar');
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) {
      const j = findJourney(from, to, explore, date);
      for (const o of j.options) {
        if (j.dateMiss) continue;
        expect(runsOn(o.legs[0].train, o.legs[0].board, date)).not.toBe(false);
      }
    }
  });

  it('lists only specials running on the chosen date', () => {
    const from = place('Bengaluru');
    const to = place('Patna, Bihar');
    const onDate = specialsFor(from, to, { ...ctx, date: '2026-11-01' });
    const afterSeason = specialsFor(from, to, { ...ctx, date: '2027-01-15' });
    expect(onDate.every((s) => !s.first || s.first <= '2026-11-01')).toBe(true);
    expect(afterSeason).toEqual([]);
  });
});
