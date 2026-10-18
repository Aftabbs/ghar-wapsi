// Explore mode: satellite imagery, place names, and tap-for-facts panels.

import type { Layer, PickingInfo } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, GeoJsonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import type { Migration, RailTravel, RouteData } from './card';
import {
  districtPanel,
  type ExploreData,
  type FareData,
  type Panel,
  stationPanel,
  statePanel,
  trainPanel,
} from './explore';
import type { Special } from './festival';

// EOX Sentinel-2 cloudless 2024: keyless, CC BY-NC-SA 4.0. The credit is in the page
// footer (#satellite-credit) and shown whenever explore mode is on.
const SATELLITE = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg';

interface Loaded {
  explore: ExploreData;
  fares: FareData;
  districts: {
    features: { properties: { code: number; name: string }; geometry: { type: string; coordinates: unknown } }[];
  };
  routes: RouteData;
  migration: Migration;
  travel: RailTravel;
  stationTrains: Map<string, number>;
  trainsByNumber: Map<string, ExploreData['trains'][number]>;
}

let loaded: Loaded | null = null;

export async function loadExplore(dataUrl: string): Promise<Loaded> {
  if (loaded) return loaded;
  const get = (name: string) => fetch(`${dataUrl}${name}`).then((r) => r.json());
  const [explore, fares, districts, routes, migration, travel] = await Promise.all([
    get('explore.json'),
    get('fares.json'),
    get('india-districts.json'),
    get('routes.json'),
    get('migration-2011.json'),
    get('rail-travel-2023.json'),
  ]);
  const stationTrains = new Map<string, number>();
  for (const t of (explore as ExploreData).trains) {
    for (const [code] of t.stops) stationTrains.set(code, (stationTrains.get(code) ?? 0) + 1);
  }
  loaded = {
    explore,
    fares,
    districts,
    routes,
    migration,
    travel,
    stationTrains,
    trainsByNumber: new Map((explore as ExploreData).trains.map((t) => [t.n, t])),
  };
  return loaded;
}

function labelPoint(geometry: { type: string; coordinates: unknown }): [number, number] {
  // Centre of the largest ring's bounding box: good enough for a label.
  const rings: [number, number][][] =
    geometry.type === 'Polygon'
      ? [(geometry.coordinates as [number, number][][])[0]]
      : (geometry.coordinates as [number, number][][][]).map((p) => p[0]);
  const ring = rings.reduce((a, b) => (b.length > a.length ? b : a));
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const LABEL = {
  getColor: [255, 255, 255, 235] as [number, number, number, number],
  fontFamily: 'Noto Sans, system-ui, sans-serif',
  fontSettings: { sdf: true },
  outlineWidth: 4,
  outlineColor: [0, 0, 0, 200] as [number, number, number, number],
  characterSet: 'auto' as const,
  billboard: false,
};

export function exploreBaseLayers(states: unknown, zoom: number): Layer[] {
  const out: Layer[] = [
    new TileLayer({
      id: 'satellite',
      data: SATELLITE,
      minZoom: 0,
      maxZoom: 14,
      tileSize: 256,
      renderSubLayers: (props) => {
        const { west, south, east, north } = props.tile.bbox as {
          west: number;
          south: number;
          east: number;
          north: number;
        };
        return new BitmapLayer({ ...props, data: undefined, image: props.data, bounds: [west, south, east, north] });
      },
    }),
    // Dim the imagery slightly so the gold trains stay readable on bright terrain.
    new GeoJsonLayer({
      id: 'explore-states',
      data: states as never,
      filled: true,
      stroked: true,
      getFillColor: [7, 11, 22, 70],
      getLineColor: [255, 255, 255, 150],
      lineWidthMinPixels: 1.2,
      pickable: true,
      autoHighlight: false,
      highlightColor: [255, 179, 71, 40],
    }),
  ];
  if (loaded && zoom >= 5.5) {
    out.push(
      new GeoJsonLayer({
        id: 'explore-districts',
        data: loaded.districts as never,
        filled: true,
        stroked: true,
        getFillColor: [0, 0, 0, 1],
        getLineColor: [255, 255, 255, 70],
        lineWidthMinPixels: 0.6,
        pickable: true,
        autoHighlight: false,
        highlightColor: [255, 179, 71, 50],
      }),
    );
  }
  return out;
}

export function exploreTopLayers(states: { features: { properties: { name: string }; geometry: never }[] }, zoom: number): Layer[] {
  if (!loaded) return [];
  const stations = Object.entries(loaded.explore.stations).map(([code, s]) => ({
    code,
    name: s[0],
    position: [s[1], s[2]] as [number, number],
    trains: loaded!.stationTrains.get(code) ?? 0,
  }));
  // Busier stations get their names first as you zoom in.
  const minTrains = zoom >= 9 ? 0 : zoom >= 8 ? 10 : zoom >= 7 ? 30 : zoom >= 6 ? 80 : Infinity;
  const out: Layer[] = [
    new TextLayer({
      id: 'state-labels',
      data: states.features,
      getPosition: (f) => labelPoint(f.geometry),
      getText: (f) => (f.properties.name === 'NCT of Delhi' ? 'Delhi' : f.properties.name),
      getSize: zoom < 5 ? 12 : 15,
      ...LABEL,
      getColor: [255, 214, 140, 230],
    }),
  ];
  if (zoom >= 6.5) {
    out.push(
      new TextLayer({
        id: 'district-labels',
        data: loaded.districts.features,
        getPosition: (f) => labelPoint(f.geometry),
        getText: (f) => f.properties.name,
        getSize: 12,
        ...LABEL,
        getColor: [220, 228, 245, 200],
      }),
    );
  }
  if (zoom >= 6) {
    out.push(
      new ScatterplotLayer({
        id: 'explore-stations',
        data: stations.filter((s) => s.trains > 0),
        getPosition: (s) => s.position,
        getRadius: (s) => Math.min(9, 2.5 + Math.sqrt(s.trains) / 2),
        radiusUnits: 'pixels',
        getFillColor: [255, 255, 255, 220],
        getLineColor: [0, 0, 0, 200],
        stroked: true,
        lineWidthMinPixels: 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 179, 71, 255],
      }),
      new TextLayer({
        id: 'station-labels',
        data: stations.filter((s) => s.trains >= minTrains),
        getPosition: (s) => s.position,
        getText: (s) => s.name,
        getSize: 13,
        getPixelOffset: [0, -12],
        ...LABEL,
      }),
    );
  }
  return out;
}

/** The panel for whatever was tapped, or null for empty map. */
export function panelFor(
  info: PickingInfo,
  ctx: { trainNumber: (layerId: string, index: number) => string | null; specials: Special[]; minute: number },
): Panel | null {
  if (!loaded || !info.layer) return null;
  const id = info.layer.id;
  if (id === 'long' || id === 'rest') {
    const number = ctx.trainNumber(id, info.index);
    const train = number ? loaded.trainsByNumber.get(number) : undefined;
    return train ? trainPanel(train, loaded.explore, loaded.fares) : null;
  }
  if (id === 'explore-stations' && info.object) {
    return stationPanel((info.object as { code: string }).code, loaded.explore, ctx.specials, ctx.minute);
  }
  if (id === 'explore-districts' && info.object) {
    const code = String((info.object as { properties: { code: number } }).properties.code);
    return loaded.routes.districts[code]
      ? districtPanel(code, loaded.routes, loaded.migration, loaded.explore)
      : null;
  }
  if (id === 'explore-states' && info.object) {
    const name = (info.object as { properties: { name: string } }).properties.name;
    return statePanel(name, loaded.travel, ctx.specials, loaded.migration);
  }
  return null;
}

export function renderPanel(root: HTMLElement, panel: Panel) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  root.innerHTML = `
    <p class="panel-kind">${esc(panel.subtitle)}</p>
    <h2 id="info-title">${esc(panel.title)}</h2>
    <dl>${panel.rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join('')}</dl>
    ${
      panel.list && panel.list.items.length
        ? `<details><summary>${esc(panel.list.heading)}</summary><ol>${panel.list.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol></details>`
        : ''
    }
    ${panel.note ? `<p class="panel-note">${esc(panel.note)}</p>` : ''}
    ${(panel.links ?? []).map((l) => `<p><a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.text)} ↗</a></p>`).join('')}
    <p class="panel-source">Source: ${esc(panel.source)}</p>`;
}
