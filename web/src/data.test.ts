import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { activeTrips, clockLabel, decodeTrips, WINDOW } from './data';

const dataDir = fileURLToPath(new URL('../public/data/', import.meta.url));
const report = JSON.parse(readFileSync(fileURLToPath(new URL('../../pipeline/report.json', import.meta.url)), 'utf8'));

function load(name: string) {
  const bytes = readFileSync(dataDir + name);
  return decodeTrips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

describe('decodeTrips', () => {
  for (const file of ['trains-long.bin', 'trains-rest.bin']) {
    it(`matches the pipeline report for ${file}`, () => {
      const trips = load(file);
      const expected = report.files.find((f: { file: string }) => f.file === file);
      expect(trips.length).toBe(expected.trips);
      expect(trips.timestamps.length).toBe(expected.points);
      expect(trips.startIndices[trips.length]).toBe(expected.points);
    });
  }

  it('puts every point inside India and every trip in time order', () => {
    const trips = load('trains-long.bin');
    for (let i = 0; i < trips.timestamps.length; i++) {
      const lon = trips.positions[2 * i];
      const lat = trips.positions[2 * i + 1];
      expect(lon > 68 && lon < 98 && lat > 6 && lat < 38).toBe(true);
    }
    for (let t = 0; t < trips.length; t++) {
      for (let i = trips.startIndices[t] + 1; i < trips.startIndices[t + 1]; i++) {
        expect(trips.timestamps[i]).toBeGreaterThan(trips.timestamps[i - 1]);
      }
    }
  });

  it('keeps hundreds of long-distance trains moving at any hour', () => {
    const trips = load('trains-long.bin');
    for (let minute = WINDOW[0]; minute < WINDOW[1]; minute += 120) {
      expect(activeTrips(trips, minute)).toBeGreaterThan(300);
    }
  });

  it('rejects files that are not GWT1', () => {
    expect(() => decodeTrips(new ArrayBuffer(40))).toThrow(/GWT1/);
  });
});

describe('clockLabel', () => {
  it('formats minutes within the looping day', () => {
    expect(clockLabel(WINDOW[0])).toBe('00:00');
    expect(clockLabel(WINDOW[0] + 22 * 60 + 5)).toBe('22:05');
    expect(clockLabel(WINDOW[1] - 1)).toBe('23:59');
  });
});
