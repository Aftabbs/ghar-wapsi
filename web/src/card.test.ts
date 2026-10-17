import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { cardFacts, formatIndian, type Migration, type RailTravel, type RouteData } from './card';
import type { Special } from './festival';

const load = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/${name}`, import.meta.url)), 'utf8'));

const routes: RouteData = load('routes.json');
const migration: Migration = load('migration-2011.json');
const travel: RailTravel = load('rail-travel-2023.json');
const specials: Special[] = load('specials-2026.json');
const trains = new Map<string, string>(load('trains.meta.json').map((t: { n: string; name: string }) => [t.n, t.name]));
const data = { routes, migration, travel, specials, trains };

const district = (name: string, state: string) =>
  Object.entries(routes.districts).find(([, d]) => d[0] === name && d[4] === state)![0];

describe('cardFacts', () => {
  it('Bengaluru to Patna: 2026 timetable and notices first, then 2023 travel, then the Census', () => {
    const patna = district('Patna', 'Bihar');
    const facts = cardFacts('bengaluru', patna, data);
    expect(facts.title).toBe('Bengaluru → Patna');

    const route = routes.routes.bengaluru[patna];
    if (route && route.length === 2) {
      const [hours, number] = route;
      expect(facts.lines[1]).toEqual({
        text: `Fastest direct train: ${number} ${trains.get(number)}, about ${Math.round(hours)} h`,
        source: 'Trains at a Glance 2026',
      });
    }

    const expectedSpecials = specials.filter(
      (s) => s.oDistrict === 572 && s.dState === 'Bihar' && s.oState === 'Karnataka',
    ).length;
    expect(facts.lines[2].text).toContain(expectedSpecials ? `${expectedSpecials} verified` : 'No verified');

    const share = travel.shares.Bihar.Karnataka;
    expect(share).toBe(1.16);
    expect(facts.lines[3].text).toBe(
      'In 2023, 1.2% of long-distance unreserved train trips from Bihar went to Karnataka',
    );

    expect(migration.districts['572'].from.Bihar).toBe(65002);
    expect(facts.lines[4]).toEqual({
      text: `${formatIndian(65002)} people from Bihar lived in Bengaluru`,
      source: 'Census 2011, the latest count; Census 2027 results are pending',
    });
  });

  it('names the neighbouring district when it borrows its train', () => {
    const borrowed = Object.entries(routes.routes.bengaluru).find(([, r]) => r.length === 3)!;
    const facts = cardFacts('bengaluru', borrowed[0], data);
    expect(facts.lines[1].text).toMatch(/^Nearest direct train goes to /);
  });

  it('says so when no direct train is listed, without inventing one', () => {
    const missing = Object.keys(routes.districts).find((d) => !routes.routes.bengaluru[d] && d !== '572')!;
    const facts = cardFacts('bengaluru', missing, data);
    expect(facts.lines[1].text).toBe('No direct train listed in Trains at a Glance 2026');
  });

  it('labels Telangana homes as undivided Andhra Pradesh in the 2011 Census line', () => {
    const facts = cardFacts('mumbai', district('Warangal', 'Telangana'), data);
    const census = facts.lines.find((l) => l.source.startsWith('Census'))!;
    expect(census.text).toMatch(/people from undivided Andhra Pradesh lived in Mumbai$/);
    const rail = facts.lines.find((l) => l.source.startsWith('EAC-PM'))!;
    expect(rail.text).toContain('from Telangana went to Maharashtra');
  });

  it('adds up every district of a multi-district city for the Census line', () => {
    const facts = cardFacts('delhi', district('Siwan', 'Bihar'), data);
    const expected = routes.cities.delhi.districts.reduce(
      (sum, d) => sum + (migration.districts[String(d)]?.from.Bihar ?? 0),
      0,
    );
    expect(facts.lines.at(-1)!.text).toBe(`${formatIndian(expected)} people from Bihar lived in Delhi`);
  });

  it('omits the migration lines for a home in the same state', () => {
    const facts = cardFacts('bengaluru', district('Mysore', 'Karnataka'), data);
    expect(facts.lines.some((l) => l.source.startsWith('Census') || l.source.startsWith('EAC-PM'))).toBe(false);
  });
});
