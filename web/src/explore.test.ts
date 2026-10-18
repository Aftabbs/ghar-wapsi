import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Migration, RailTravel, RouteData } from './card';
import {
  clock,
  districtPanel,
  type ExploreData,
  fareCategory,
  fareRanges,
  type FareData,
  stationPanel,
  statePanel,
  trainPanel,
} from './explore';
import type { Special } from './festival';

const load = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/${name}`, import.meta.url)), 'utf8'));
const explore: ExploreData = load('explore.json');
const fares: FareData = load('fares.json');
const routes: RouteData = load('routes.json');
const migration: Migration = load('migration-2011.json');
const travel: RailTravel = load('rail-travel-2023.json');
const specials: Special[] = load('specials-2026.json');
const train = (n: string) => explore.trains.find((t) => t.n === n)!;

describe('fare estimates', () => {
  // Real fares from IRCTC (via erail.in), October 2026.
  it.each([
    ['12627', 'SL', 930],
    ['12627', '3A', 2325],
    ['12627', '2A', 3335],
    ['12295', 'SL', 995],
    ['12295', '3A', 2470],
  ])('the range for %s %s contains the real fare', (number, cls, real) => {
    const range = fareRanges(train(number), fares).find((r) => r.cls === cls)!;
    expect(range.low).toBeLessThanOrEqual(real);
    expect(range.high).toBeGreaterThanOrEqual(real);
    expect(range.high / range.low).toBeLessThan(1.2); // a useful range, not a shrug
  });

  it('gives no estimate where the fare rules differ', () => {
    expect(fareCategory('Rani Kamalapati Hazrat Nizamuddin Vande Bharat Sleeper')).toBeNull();
    expect(fareCategory('Saharsa Amritsar Amrit Bharat Express')).toBeNull();
    expect(fareCategory('Howrah New Delhi Rajdhani Express')).toEqual({ category: 'rajdhani' });
  });
});

describe('panels', () => {
  it('describes a train from its timetable', () => {
    const panel = trainPanel(train('12627'), explore, fares);
    const t = train('12627');
    expect(panel.title).toBe(`12627 ${t.name}`);
    expect(panel.rows[0].value).toBe(`${explore.stations[t.stops[0][0]][0]} (${t.stops[0][0]}) at ${clock(t.stops[0][2])}`);
    expect(panel.rows.find((r) => r.label === 'Runs')!.value).toBe('Daily');
    expect(panel.rows.find((r) => r.label === 'Fare (estimate)')!.value).toContain('Sleeper ₹');
    expect(panel.links![0].href).toBe('https://www.irctc.co.in/');
  });

  it('lists the next departures from a station after the map clock', () => {
    const panel = stationPanel('SBC', explore, specials, 20 * 60);
    expect(panel.title).toBe('KSR Bengaluru (SBC)');
    const times = panel.list!.items.map((i) => i.slice(0, 5));
    expect(times.length).toBeGreaterThan(0);
    const minutes = times.map((t) => ((Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) - 20 * 60 + 1440) % 1440));
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it('shows where a district’s newcomers came from', () => {
    const panel = districtPanel('572', routes, migration, explore);
    expect(panel.title).toBe('Bangalore');
    expect(panel.rows.find((r) => r.label === 'Came from (2011)')!.value).toMatch(/^Tamil Nadu 5,83,467/);
  });

  it('shows where a state’s rail trips went in 2023', () => {
    const panel = statePanel('Bihar', travel, specials, migration);
    expect(panel.rows[0].value.startsWith('Bihar')).toBe(false);
    expect(panel.rows[0].value).toContain('Delhi 13.8%');
  });
});
