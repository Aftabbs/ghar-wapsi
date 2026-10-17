import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { cardFacts, formatIndian, type Migration, type RouteData } from './card';
import type { Special } from './festival';

const load = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/${name}`, import.meta.url)), 'utf8'));

const routes: RouteData = load('routes.json');
const migration: Migration = load('migration-2011.json');
const specials: Special[] = load('specials-2026.json');
const trains = new Map<string, string>(load('trains.meta.json').map((t: { n: string; name: string }) => [t.n, t.name]));
const data = { routes, migration, specials, trains };

const district = (name: string, state: string) =>
  Object.entries(routes.districts).find(([, d]) => d[0] === name && d[1] === state)![0];

describe('cardFacts', () => {
  it('Bengaluru to Patna uses the timetable, the notices and the Census, and nothing else', () => {
    const patna = district('Patna', 'Bihar');
    const facts = cardFacts('bengaluru', patna, data);
    expect(facts.title).toBe('Bengaluru → Patna');

    const [hours, number] = routes.routes.bengaluru[patna];
    expect(facts.lines[1].text).toBe(`Fastest direct train: ${number} ${trains.get(number)}, about ${Math.round(hours)} h`);

    const expectedSpecials = specials.filter(
      (s) => s.oDistrict === 572 && s.dState === 'Bihar' && s.oState === 'Karnataka',
    ).length;
    expect(facts.lines[2].text).toContain(expectedSpecials ? `${expectedSpecials} verified` : 'No verified');

    const people = migration.districts['572'].from.Bihar;
    expect(people).toBe(65002);
    expect(facts.lines[3].text).toBe(`${formatIndian(people)} people from Bihar lived in Bengaluru in 2011`);
    expect(facts.lines[3].source).toMatch(/Census 2011/);
  });

  it('names the neighbouring district when it borrows its train', () => {
    const kolkata = district('Kolkata', 'West Bengal');
    const route = routes.routes.bengaluru[kolkata];
    expect(route).toHaveLength(3);
    const facts = cardFacts('bengaluru', kolkata, data);
    expect(facts.lines[1].text).toMatch(/^Nearest direct train goes to /);
  });

  it('says so when there is no direct train, without inventing one', () => {
    const missing = Object.keys(routes.districts).find((d) => !routes.routes.bengaluru[d] && d !== '572')!;
    const facts = cardFacts('bengaluru', missing, data);
    expect(facts.lines[1].text).toBe('No direct train in the 2016 timetable');
  });

  it('adds up every district of a multi-district city for the Census line', () => {
    const facts = cardFacts('delhi', district('Siwan', 'Bihar'), data);
    const expected = routes.cities.delhi.districts.reduce(
      (sum, d) => sum + (migration.districts[String(d)]?.from.Bihar ?? 0),
      0,
    );
    expect(facts.lines.at(-1)!.text).toBe(`${formatIndian(expected)} people from Bihar lived in Delhi in 2011`);
  });

  it('omits the Census line for a home in the same state', () => {
    const facts = cardFacts('bengaluru', district('Mysore', 'Karnataka'), data);
    expect(facts.lines.some((l) => l.source.startsWith('Census'))).toBe(false);
  });
});
