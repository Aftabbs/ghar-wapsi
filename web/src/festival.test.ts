import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { WINDOW } from './data';
import { arcPath, isHomeward, type Special, specialTrips, summary } from './festival';

const specials: Special[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/data/specials-2026.json', import.meta.url)), 'utf8'),
);

describe('festival specials', () => {
  it('classifies Bengaluru to Assam as homeward and the return as not', () => {
    const out = specials.find((s) => s.n === '06559')!;
    const back = specials.find((s) => s.n === '06560')!;
    expect(isHomeward(out)).toBe(true);
    expect(isHomeward(back)).toBe(false);
  });

  it('draws arcs that start and end at the stations', () => {
    const path = arcPath([77.6, 13.0], [92.1, 26.8]);
    expect(path[0]).toEqual([77.6, 13.0]);
    expect(path.at(-1)![0]).toBeCloseTo(92.1);
    expect(path.at(-1)![1]).toBeCloseTo(26.8);
  });

  it('animates only timed specials, each spanning its stated journey', () => {
    const trips = specialTrips(specials);
    expect(trips.length).toBeGreaterThan(0);
    for (const trip of trips) {
      const span = (trip.timestamps.at(-1)! - trip.timestamps[0]) / 60;
      expect(span).toBeCloseTo(trip.special.hours!, 5);
      expect(trip.timestamps[0]).toBeLessThan(WINDOW[1]);
      expect(trip.timestamps.at(-1)!).toBeGreaterThan(WINDOW[0]);
    }
    expect(trips.every((t) => t.special.dep && t.special.hours != null)).toBe(true);
  });

  it('summarises counts straight from the verified rows', () => {
    const s = summary(specials);
    expect(s.total).toBe(specials.length);
    expect(s.homeward).toBe(specials.filter(isHomeward).length);
    expect(s.verifiedOn).toBe('2026-10-17');
  });
});
