import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { answer, type Context } from './answer';
import type { ExploreData } from './explore';
import { buildPlaces, type Places, searchPlaces } from './places';
import { townsFor } from './towns';

const DATA = '../public/data/';
const read = (name: string) => readFileSync(fileURLToPath(new URL(`${DATA}${name}`, import.meta.url)), 'utf8');
const places: Places = JSON.parse(read('places.json'));
const explore: ExploreData = JSON.parse(read('explore.json'));
const base = buildPlaces(places, explore);

beforeAll(() => {
  // Serve the town files from disk, as the site serves them over the network.
  vi.stubGlobal('fetch', async (url: string) => ({ json: async () => JSON.parse(read(url.replace('data:', ''))) }));
});

async function find(text: string) {
  return searchPlaces(text, [...base, ...(await townsFor(text, 'data:', places))], 5);
}

describe('towns and small stations', () => {
  it('finds a hometown that is not a main stop in the timetable', async () => {
    const [kadur] = await find('Kadur');
    expect(kadur.label).toBe('Kadur, Chikkamagaluru, Karnataka');
    expect(kadur.localStation).toBe('DRU');
  });

  it('ignores accents, so every Kadur is found', async () => {
    const labels = (await find('Kadur')).map((p) => p.label);
    expect(labels).toContain('Kadur, Chikkamagaluru, Karnataka');
    expect(labels.some((l) => /^Kadūr, Chitradurga/.test(l))).toBe(true);
  });

  it('puts big places before villages while the name is half typed', async () => {
    expect((await find('Benga'))[0].label).toBe('Bengaluru, Karnataka');
    expect((await find('Kadu'))[0].label).toBe('Kadur, Chikkamagaluru, Karnataka');
  });

  it('waits for enough letters before fetching a file', async () => {
    expect(await townsFor('k', 'data:', places)).toEqual([]);
  });

  it('routes through the nearest main station and says so', async () => {
    const [kadur] = await find('Kadur');
    const ctx: Context = {
      explore,
      fares: JSON.parse(read('fares.json')),
      specials: JSON.parse(read('specials-2026.json')),
      migration: JSON.parse(read('migration-2011.json')),
      travel: JSON.parse(read('rail-travel-2023.json')),
      today: '2026-10-22',
    };
    const a = answer(searchPlaces('Bengaluru', base, 1)[0], kadur, ctx);
    expect(a.steps.length).toBeGreaterThan(0);
    expect(a.notes[0]).toMatch(/^Kadur station is not a main stop in the official timetable, so this uses .+ km away/);
  });
});
