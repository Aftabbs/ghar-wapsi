import { Deck, FlyToInterpolator, type MapViewState, WebMercatorViewport } from '@deck.gl/core';
import { TripsLayer } from '@deck.gl/geo-layers';
import { GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import { activeTrips, clockLabel, DAY, loadTrips, type TripBuffers, WINDOW } from './data';
import {
  arcPath,
  isHomeward,
  type Special,
  type SpecialTrip,
  specialTrips,
} from './festival';
import {
  exploreBaseLayers,
  exploreTopLayers,
  loadExplore,
  loadSearch,
  panelFor,
  renderPanel,
} from './exploreUi';
import { type Route, setupSearch } from './search';
import './style.css';

const DATA = `${import.meta.env.BASE_URL}data/`;
// Wherever the site is served from, without the protocol: printed on every card.
const SITE_URL = `${location.host}${import.meta.env.BASE_URL}`.replace(/\/$/, '');
const LOOP_SECONDS = 60; // one clock day per minute of real time
const MINUTES_PER_MS = DAY / (LOOP_SECONDS * 1000);
const TRAIL_MIN = { full: 40, light: 25 }; // short trails read as moving trains, long ones as track
const SLOW_FRAME_MS = 40; // slower than ~25 fps on average: switch to the light path
const SPECIAL_TRAIL_MIN = 360; // specials leave a long gold wake so the arc home reads
const GOLD: [number, number, number] = [255, 205, 90];
// Additive blending: where trains overlap, the light adds up into a glow.
const GLOW = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const;

const ui = {
  clock: document.querySelector<HTMLSpanElement>('#clock')!,
  play: document.querySelector<HTMLButtonElement>('#play')!,
  time: document.querySelector<HTMLInputElement>('#time')!,
  status: document.querySelector<HTMLParagraphElement>('#status')!,
  summary: document.querySelector<HTMLParagraphElement>('#summary-text')!,
  festival: document.querySelector<HTMLButtonElement>('#festival')!,
  season: document.querySelector<HTMLElement>('#season')!,
  seasonText: document.querySelector<HTMLElement>('#season-text')!,
  legend: document.querySelector<HTMLParagraphElement>('#legend')!,
  explore: document.querySelector<HTMLButtonElement>('#explore')!,
  info: document.querySelector<HTMLElement>('#info')!,
  infoBody: document.querySelector<HTMLElement>('#info-body')!,
  infoClose: document.querySelector<HTMLButtonElement>('#info-close')!,
  credit: document.querySelector<HTMLElement>('#satellite-credit')!,
  live: document.querySelector<HTMLElement>('#live')!,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Minutes past midnight in India (UTC+5:30), whatever the visitor's clock zone. */
function indiaNow(): number {
  const now = new Date();
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % DAY;
}

const state = {
  minute: WINDOW[0] + indiaNow(), // open at the time it is in India, so the map is live
  playing: !reducedMotion,
  light: false,
  long: null as TripBuffers | null,
  rest: null as TripBuffers | null,
  states: null as unknown,
  festival: false,
  route: null as Route | null,
  specials: [] as Special[],
  specialTrips: [] as SpecialTrip[],
  explore: false,
  zoom: 0,
  meta: [] as { n: string }[],
};

// Mainland India plus the Northeast; islands may sit off the fitted view.
const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [68.1, 7.9],
  [97.4, 35.7],
];

/** Space the panel leaves for the map: beside it on wide screens, above it on phones. */
function mapPadding() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const panel = document.querySelector('.panel')!.getBoundingClientRect();
  const stacked = width < 760; // panel sits under the map rather than beside it
  return {
    top: stacked ? 52 : 32, // room for the end labels; on phones the credits and live count sit along the top
    bottom: Math.round(stacked ? Math.max(height - panel.top, 0) + 12 : 40),
    left: Math.round(stacked ? 44 : panel.right + 24), // room for the end labels
    right: stacked ? 44 : 24,
  };
}

function fitView(bounds: [[number, number], [number, number]], maxZoom = 12): MapViewState {
  const { width, height } = { width: window.innerWidth, height: window.innerHeight };
  const { longitude, latitude, zoom } = new WebMercatorViewport({ width, height }).fitBounds(bounds, {
    padding: mapPadding(),
    maxZoom,
  });
  return { longitude, latitude, zoom, minZoom: Math.min(zoom, 3), maxZoom: 12 };
}

/** Fit India into the space the panel leaves. */
function initialView(): MapViewState {
  return fitView(INDIA_BOUNDS);
}

function tripsLayer(id: string, trips: TripBuffers, color: [number, number, number], width: number) {
  return new TripsLayer({
    id,
    data: {
      length: trips.length,
      startIndices: trips.startIndices,
      attributes: {
        getPath: { value: trips.positions, size: 2 },
        getTimestamps: { value: trips.timestamps, size: 1 },
      },
    },
    // Binary data: positions are flat lon/lat pairs, not [x, y, z] arrays.
    _pathType: 'open',
    currentTime: state.minute,
    trailLength: state.light ? TRAIL_MIN.light : TRAIL_MIN.full,
    getColor: color,
    // In explore mode trains are wider and can be tapped.
    widthMinPixels: state.explore ? width + 2 : width,
    pickable: state.explore,
    autoHighlight: state.explore,
    highlightColor: [255, 255, 255, 255],
    capRounded: true,
    jointRounded: true,
    fadeTrail: true,
    // A searched route stands out by dimming every other train.
    opacity: state.route ? 0.12 : state.festival ? 0.22 : 0.9,
    parameters: GLOW,
  });
}

function layers() {
  const out = [];
  if (state.explore) {
    out.push(...exploreBaseLayers(state.states, state.zoom));
  } else if (state.states) {
    out.push(
      new GeoJsonLayer({
        id: 'states',
        data: state.states as never,
        filled: true,
        stroked: true,
        getFillColor: [15, 22, 40, 255],
        getLineColor: [34, 48, 79, 255],
        lineWidthMinPixels: 0.6,
      }),
    );
  }
  if (state.rest && !state.light) out.push(tripsLayer('rest', state.rest, [255, 140, 70], 1));
  if (state.long) out.push(tripsLayer('long', state.long, [255, 196, 110], 2));
  if (state.festival) out.push(...festivalLayers());
  if (state.route) out.push(...routeLayers(state.route));
  if (state.explore && state.states) out.push(...exploreTopLayers(state.states as never, state.zoom));
  return out;
}

function festivalLayers() {
  const homeward = state.specials.filter(isHomeward);
  return [
    // Every verified homeward special as a faint route, including those whose notice
    // gives no timings (they are drawn but never animated).
    new PathLayer<Special>({
      id: 'special-routes',
      data: homeward,
      getPath: (s) => arcPath(s.from, s.to),
      getColor: [...GOLD, 70],
      widthMinPixels: 1,
    }),
    new TripsLayer<SpecialTrip>({
      id: 'special-trips',
      data: state.specialTrips.filter((t) => isHomeward(t.special)),
      getPath: (t) => t.path,
      getTimestamps: (t) => t.timestamps,
      getColor: GOLD,
      currentTime: state.minute,
      trailLength: SPECIAL_TRAIL_MIN,
      widthMinPixels: 3,
      capRounded: true,
      jointRounded: true,
      fadeTrail: true,
      parameters: GLOW,
    }),
    new ScatterplotLayer<Special>({
      id: 'special-ends',
      data: homeward,
      getPosition: (s) => s.to,
      getRadius: 3,
      radiusUnits: 'pixels',
      getFillColor: [...GOLD, 200],
    }),
  ];
}

function routeLayers(route: Route) {
  const ends = [
    { at: route.from, label: route.labels[0] },
    { at: route.to, label: route.labels[1] },
  ];
  return [
    new PathLayer<[number, number][]>({
      id: 'route-road',
      data: route.roads,
      getPath: (p) => p,
      getColor: [255, 227, 163, 150],
      widthMinPixels: 2,
    }),
    new PathLayer<[number, number][]>({
      id: 'route',
      data: route.paths,
      getPath: (p) => p,
      getColor: [...GOLD, 255],
      widthMinPixels: 4,
      capRounded: true,
      jointRounded: true,
      parameters: GLOW,
    }),
    new ScatterplotLayer<(typeof ends)[number]>({
      id: 'route-ends',
      data: ends,
      getPosition: (e) => e.at,
      getRadius: 7,
      radiusUnits: 'pixels',
      getFillColor: [255, 227, 163, 255],
      stroked: true,
      getLineColor: [7, 11, 22, 255],
      lineWidthMinPixels: 2,
    }),
    new TextLayer<(typeof ends)[number]>({
      id: 'route-labels',
      data: ends,
      getPosition: (e) => e.at,
      getText: (e) => e.label,
      getSize: 15,
      getColor: [255, 255, 255, 255],
      getPixelOffset: [0, -18],
      fontFamily: 'Noto Sans, system-ui, sans-serif',
      fontWeight: 600,
      outlineWidth: 3,
      outlineColor: [7, 11, 22, 255],
      fontSettings: { sdf: true },
    }),
  ];
}

function showRoute(route: Route | null) {
  state.route = route;
  if (route) {
    const points = [route.from, route.to, ...route.paths.flat(), ...route.roads.flat()];
    const lons = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const view = fitView(
      [
        [Math.min(...lons) - 0.3, Math.min(...lats) - 0.3],
        [Math.max(...lons) + 0.3, Math.max(...lats) + 0.3],
      ],
      8,
    );
    // No fly-in for reduced motion or a background tab, where animation frames are paused.
    const animate = !reducedMotion && !document.hidden;
    deck.setProps({ initialViewState: animate ? { ...view, transitionDuration: 900, transitionInterpolator: new FlyToInterpolator() } : view });
    ui.legend.textContent = route.roads.length
      ? 'Your train in gold, the road part in pale gold. Every other train is dimmed.'
      : 'Your train in gold. Every other train is dimmed.';
  } else {
    deck.setProps({ initialViewState: initialView() });
    ui.legend.textContent = 'Every light is a train in the 2026 timetable, starting at the time in India now. A day passes in 60 seconds.';
  }
  render();
}

const deck = new Deck({
  parent: document.querySelector<HTMLDivElement>('#map')!,
  initialViewState: initialView(),
  controller: { dragRotate: false, touchRotate: false },
  layers: [],
  // A forgiving tap target: station dots are small, especially under a finger.
  pickingRadius: 12,
  onViewStateChange: ({ viewState }) => {
    // Labels and districts depend on zoom; re-render when it crosses a step.
    const zoom = Math.round((viewState as { zoom: number }).zoom * 4) / 4;
    if (zoom !== state.zoom) {
      state.zoom = zoom;
      render();
    }
  },
  getCursor: ({ isHovering }) => (isHovering && state.explore ? 'pointer' : 'grab'),
  onClick: (info) => {
    if (!state.explore) return;
    const panel = panelFor(info, {
      trainNumber: (layerId, index) => {
        const trips = layerId === 'long' ? state.long : state.rest;
        const meta = trips ? state.meta[trips.trainIndex[index]] : undefined;
        return meta?.n ?? null;
      },
      specials: state.specials,
      minute: state.minute,
    });
    if (!panel) return;
    renderPanel(ui.infoBody, panel);
    ui.info.hidden = false;
    ui.infoClose.focus();
  },
});

// A small hook for scripted views (tests and the launch video).
(window as unknown as { nativePlaceMap: object }).nativePlaceMap = {
  flyTo: (longitude: number, latitude: number, zoom: number) => {
    deck.setProps({ initialViewState: { ...initialView(), longitude, latitude, zoom } });
    // Setting the view directly does not raise onViewStateChange, so record the zoom here.
    state.zoom = zoom;
    render();
  },
  explore: (on: boolean) => setExplore(on),
  zoom: () => state.zoom,
  view: () => {
    const v = deck.getViewports()[0] as unknown as { longitude: number; latitude: number; zoom: number };
    return { longitude: v.longitude, latitude: v.latitude, zoom: v.zoom };
  },
  layerIds: () => layers().map((l) => l.id),
};

async function setExplore(on: boolean) {
  state.explore = on;
  ui.explore.setAttribute('aria-pressed', String(on));
  ui.credit.hidden = !on;
  if (on) {
    ui.status.textContent = 'Loading places and timetable…';
    const [, meta] = await Promise.all([
      loadExplore(DATA),
      state.meta.length ? state.meta : fetch(`${DATA}trains.meta.json`).then((r) => r.json()),
    ]);
    state.meta = meta;
    ui.status.textContent = 'Tap a train, station, district or state to learn about it.';
  } else {
    ui.info.hidden = true;
    ui.status.textContent = '';
  }
  render();
}

let liveShown = -1;
/** "1,507 trains on the move at 20:08", refreshed once per map minute. */
function updateLive() {
  const minute = Math.floor(state.minute);
  if (minute === liveShown || !state.long) return;
  liveShown = minute;
  const moving = activeTrips(state.long, state.minute) + (state.rest ? activeTrips(state.rest, state.minute) : 0);
  ui.live.textContent = `${moving.toLocaleString('en-IN')} trains on the move at ${clockLabel(state.minute)}`;
}

function render() {
  deck.setProps({ layers: layers() });
  updateLive();
  ui.clock.textContent = clockLabel(state.minute);
  ui.time.value = String(Math.floor(state.minute - WINDOW[0]));
}

// Frame loop with a low-end fallback measured from real frame times.
let last = performance.now();
let slowFrames = 0;
function frame(now: number) {
  const elapsed = now - last;
  last = now;
  if (state.playing) {
    state.minute += Math.min(elapsed, 100) * MINUTES_PER_MS;
    if (state.minute >= WINDOW[1]) state.minute = WINDOW[0] + (state.minute - WINDOW[1]);
    if (!state.light) {
      slowFrames = elapsed > SLOW_FRAME_MS ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 90) {
        state.light = true;
        ui.status.textContent = 'Showing long-distance trains only, to keep this device smooth.';
      }
    }
    render();
  }
  requestAnimationFrame(frame);
}

function setFestival(on: boolean) {
  state.festival = on;
  ui.festival.setAttribute('aria-pressed', String(on));
  ui.festival.textContent = on ? 'Hide them' : 'Show them on the map';
  render();
}

/** The strip about special trains appears only while a season's specials are running. */
function showSeason(specials: Special[]) {
  const running = specials.filter((s) => !s.last || s.last >= new Date().toISOString().slice(0, 10));
  if (!running.length) return;
  const homeward = running.filter(isHomeward).length;
  ui.seasonText.textContent = `${running[0].season}: ${homeward} verified special trains are running from the big cities.`;
  ui.season.hidden = false;
}

function setPlaying(playing: boolean) {
  state.playing = playing;
  ui.play.textContent = playing ? 'Pause' : 'Play';
  ui.play.setAttribute('aria-pressed', String(playing));
}

ui.play.addEventListener('click', () => setPlaying(!state.playing));
ui.festival.addEventListener('click', () => setFestival(!state.festival));
ui.explore.addEventListener('click', () => setExplore(!state.explore));
ui.infoClose.addEventListener('click', () => {
  ui.info.hidden = true;
  ui.explore.focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !ui.info.hidden) {
    ui.info.hidden = true;
    ui.explore.focus();
  }
});
ui.time.addEventListener('input', () => {
  setPlaying(false);
  state.minute = WINDOW[0] + Number(ui.time.value);
  render();
});
document.addEventListener('keydown', (event) => {
  if (event.key === ' ' && event.target === document.body) {
    event.preventDefault();
    setPlaying(!state.playing);
  }
});

async function start() {
  setPlaying(state.playing);
  try {
    const [states, long, specials] = await Promise.all([
      fetch(`${DATA}india-states.json`).then((r) => r.json()),
      loadTrips(`${DATA}trains-long.bin`),
      fetch(`${DATA}specials-2026.json`).then((r) => r.json() as Promise<Special[]>),
    ]);
    state.states = states;
    state.long = long;
    state.specials = specials;
    state.specialTrips = specialTrips(specials);
    showSeason(specials);
    setupSearch({
      dataUrl: DATA,
      siteUrl: SITE_URL,
      specials: () => state.specials,
      states: () => state.states,
      onRoute: showRoute,
      // Counted in GoatCounter (no cookies), by state only.
      onSearch: (fromState, toState) => {
        const counter = (window as { goatcounter?: { count: (v: object) => void } }).goatcounter;
        counter?.count({ path: `search/${fromState}/${toState}`, title: 'Search', event: true });
      },
    });
    render();
    const moving = activeTrips(long, state.minute);
    ui.status.textContent = reducedMotion ? 'Animation paused because reduced motion is on. Press Play to start.' : '';
    ui.summary.textContent =
      `The map animates ${long.length.toLocaleString('en-IN')} long-distance train runs from Trains at a ` +
      `Glance 2026, the official Indian Railways timetable, across one day compressed into 60 seconds. At ` +
      `${clockLabel(state.minute)}, about ${moving.toLocaleString('en-IN')} long-distance trains are on the move.`;
    state.rest = await loadTrips(`${DATA}trains-rest.bin`);
    render();
    document.body.dataset.ready = 'true'; // for scripted checks
    // Fetch the timetable for search while the visitor reads, so the first answer is instant.
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
    idle(() => void loadSearch(DATA).catch(() => undefined));
  } catch (error) {
    ui.status.textContent = 'The train data could not be loaded. Please refresh the page.';
    console.error(error);
  }
  requestAnimationFrame(frame);
}

start();
