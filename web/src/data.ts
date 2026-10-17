// Decoder for the GWT1 trip files written by pipeline/ghar/pack.py.

export const DAY = 1440;
export const WINDOW: readonly [number, number] = [DAY, 2 * DAY];

export interface TripBuffers {
  length: number;
  startIndices: Uint32Array;
  trainIndex: Uint16Array;
  positions: Float32Array; // lon, lat pairs
  timestamps: Float32Array; // minutes; the visible day is WINDOW
}

const MAGIC = 'GWT1';
const QMAX = 65535;

export function decodeTrips(buffer: ArrayBuffer): TripBuffers {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== MAGIC) throw new Error(`not a GWT1 file (got "${magic}")`);

  const tripCount = view.getUint32(4, true);
  const pointCount = view.getUint32(8, true);
  const [minLon, minLat, maxLon, maxLat] = [12, 16, 20, 24].map((o) => view.getFloat32(o, true));
  const base = view.getInt32(28, true);
  const units = view.getUint32(32, true);

  let offset = 36;
  const startIndices = new Uint32Array(buffer.slice(offset, offset + 4 * (tripCount + 1)));
  offset += 4 * (tripCount + 1);
  const trainIndex = new Uint16Array(buffer.slice(offset, offset + 2 * tripCount));
  offset += 2 * tripCount + (tripCount % 2 ? 2 : 0);
  const rawPositions = new Uint16Array(buffer, offset, 2 * pointCount);
  offset += 4 * pointCount;
  const rawTimes = new Uint16Array(buffer, offset, pointCount);

  const positions = new Float32Array(2 * pointCount);
  const lonScale = (maxLon - minLon) / QMAX;
  const latScale = (maxLat - minLat) / QMAX;
  for (let i = 0; i < pointCount; i++) {
    positions[2 * i] = minLon + rawPositions[2 * i] * lonScale;
    positions[2 * i + 1] = minLat + rawPositions[2 * i + 1] * latScale;
  }
  const timestamps = new Float32Array(pointCount);
  for (let i = 0; i < pointCount; i++) timestamps[i] = base + rawTimes[i] / units;

  return { length: tripCount, startIndices, trainIndex, positions, timestamps };
}

export async function loadTrips(url: string): Promise<TripBuffers> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return decodeTrips(await response.arrayBuffer());
}

/** Number of trips whose span includes the given minute. */
export function activeTrips(trips: TripBuffers, minute: number): number {
  let count = 0;
  for (let t = 0; t < trips.length; t++) {
    const first = trips.timestamps[trips.startIndices[t]];
    const last = trips.timestamps[trips.startIndices[t + 1] - 1];
    if (first <= minute && minute <= last) count++;
  }
  return count;
}

export function clockLabel(minute: number): string {
  const m = ((Math.floor(minute) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
