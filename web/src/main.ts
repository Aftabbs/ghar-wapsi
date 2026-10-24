import { Deck, FlyToInterpolator, type MapViewState, WebMercatorViewport } from '@deck.gl/core';
import { TripsLayer } from '@deck.gl/geo-layers';

import { activeTrips, clockLabel, DAY, loadTrips, type TripBuffers, WINDOW } from './data';
import {
  arcPath,
  isHomeward,
  type Special,
  type SpecialTrip,
  coverage,
  specialTrips,
} from './festival';
import {
  exploreBaseLayers,
  exploreTopLayers,
  loadExplore,
  panelFor,
  renderPanel,
} from './exploreUi';
import { type Route, setupSearch, warmSearch } from './search';
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

const MIN_MAP_PX = 80; // smallest map area worth fitting into

function fitView(bounds: [[number, number], [number, number]], maxZoom = 12): MapViewState {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  let padding = mapPadding();
  // On a tiny or squashed window the panel can cover almost everything; fitting into a
  // negative space throws and would stop the whole page, so use the full window instead.
  if (width - padding.left - padding.right < MIN_MAP_PX || height - padding.top - padding.bottom < MIN_MAP_PX) {
    padding = { top: 0, bottom: 0, left: 0, right: 0 };
  }
  try {
    const { longitude, latitude, zoom } = new WebMercatorViewport({ width, height }).fitBounds(bounds, {
      padding,
      maxZoom,
    });
    return { longitude, latitude, zoom, minZoom: Math.min(zoom, 3), maxZoom: 12 };
  } catch {
    const [[w, s], [e, n]] = bounds;
    return { longitude: (w + e) / 2, latitude: (s + n) / 2, zoom: 3, minZoom: 2, maxZoom: 12 };
  }
}

/** Fit India into the space the panel leaves. */
function initialView(): MapViewState {
  return fitView(INDIA_BOUNDS);
}

// One data object per trip file. A new object each frame would make deck.gl re-process
// every train point on every frame, which was the main cause of lag on phones.
const binaryData = new WeakMap<TripBuffers, object>();
function tripData(trips: TripBuffers) {
  let data = binaryData.get(trips);
  if (!data) {
    data = {
      length: trips.length,
      startIndices: trips.startIndices,
      attributes: {
        getPath: { value: trips.positions, size: 2 },
        getTimestamps: { value: trips.timestamps, size: 1 },
      },
    };
    binaryData.set(trips, data);
  }
  return data;
}

const LONG_COLOR: [number, number, number] = [255, 196, 110];
const REST_COLOR: [number, number, number] = [255, 140, 70];
const WHITE: Rgba = [255, 255, 255, 255];
const ROUTE_COLOR: Rgba = [255, 205, 90, 255];
const ROAD_COLOR: Rgba = [255, 227, 163, 150];
const SPECIAL_ARC: Rgba = [255, 205, 90, 70];
const BORDER: Rgba = [44, 60, 96, 255];

function tripsLayer(id: string, trips: TripBuffers, color: [number, number, number], width: number) {
  return new TripsLayer({
    id,
    data: tripData(trips) as never,
    // Binary data: positions are flat lon/lat pairs, not [x, y, z] arrays.
    _pathType: 'open',
    currentTime: state.minute,
    trailLength: state.light ? TRAIL_MIN.light : TRAIL_MIN.full,
    getColor: color,
    // In explore mode trains are wider and can be tapped.
    widthMinPixels: state.explore ? width + 2 : width,
    pickable: state.explore,
    autoHighlight: state.explore,
    highlightColor: WHITE,
    capRounded: true,
    jointRounded: true,
    fadeTrail: true,
    // A searched route stands out by dimming every other train.
    opacity: state.route ? 0.12 : state.festival ? 0.22 : 0.9,
    parameters: GLOW,
  });
}

type Path2 = [number, number][];
type Rgba = [number, number, number, number];
const ZERO_TIMES = new WeakMap<Path2, number[]>();

/**
 * Still lines drawn with the trains' own shader. Every new kind of deck.gl layer
 * compiles a GPU program, which freezes the page for a second or more on many
 * phones and Windows laptops; reusing one program keeps the first screen smooth.
 */
function staticLines(id: string, paths: Path2[], color: Rgba, width: number, glow = false) {
  return new TripsLayer<Path2>({
    id,
    data: paths,
    getPath: (p) => p,
    getTimestamps: (p) => {
      let zeros = ZERO_TIMES.get(p);
      if (!zeros) ZERO_TIMES.set(p, (zeros = p.map(() => 0)));
      return zeros;
    },
    // Every vertex has time 0, inside the window (currentTime - trailLength, currentTime].
    currentTime: 1,
    trailLength: 2,
    fadeTrail: false,
    getColor: color,
    widthMinPixels: width,
    capRounded: true,
    jointRounded: true,
    parameters: glow ? GLOW : undefined,
  });
}

const outlineCache = new WeakMap<object, Path2[]>();
/** State borders and coastline as plain lines. */
function stateOutlines(states: unknown): Path2[] {
  let paths = outlineCache.get(states as object);
  if (!paths) {
    paths = [];
    for (const f of (states as { features: { geometry: { type: string; coordinates: unknown } }[] }).features) {
      const polygons =
        f.geometry.type === 'Polygon'
          ? [f.geometry.coordinates as Path2[]]
          : f.geometry.type === 'MultiPolygon'
            ? (f.geometry.coordinates as Path2[][])
            : [];
      for (const polygon of polygons) paths.push(...polygon);
    }
    outlineCache.set(states as object, paths);
  }
  return paths;
}

function layers() {
  const out = [];
  if (state.explore) {
    out.push(...exploreBaseLayers(state.states, state.zoom));
  } else if (state.states) {
    out.push(staticLines('states', stateOutlines(state.states), BORDER, 0.8));
  }
  if (state.rest && !state.light) out.push(tripsLayer('rest', state.rest, REST_COLOR, 1));
  if (state.long) out.push(tripsLayer('long', state.long, LONG_COLOR, 2));
  if (state.festival) out.push(...festivalLayers());
  if (state.route) out.push(...routeLayers(state.route));
  if (state.explore && state.states) out.push(...exploreTopLayers(state.states as never, state.zoom));
  return out;
}

const specialArcs = new WeakMap<Special[], Path2[]>();

function festivalLayers() {
  const homeward = state.specials.filter(isHomeward);
  let arcs = specialArcs.get(state.specials);
  if (!arcs) specialArcs.set(state.specials, (arcs = homeward.map((s) => arcPath(s.from, s.to))));
  return [
    // Every verified homeward special as a faint route, including those whose notice
    // gives no timings (they are drawn but never animated).
    staticLines('special-routes', arcs, SPECIAL_ARC, 1),
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
  ];
}

function routeLayers(route: Route) {
  return [
    staticLines('route-road', route.roads, ROAD_COLOR, 2),
    staticLines('route', route.paths, ROUTE_COLOR, 4, true),
  ];
}

// The two ends of a route are HTML, not map layers: no extra GPU program, crisp text.
const pins = [0, 1].map(() => {
  const pin = document.createElement('div');
  pin.className = 'pin';
  pin.setAttribute('aria-hidden', 'true');
  pin.hidden = true;
  pin.append(document.createElement('span'));
  document.querySelector('main')!.append(pin);
  return pin;
});

function placePins() {
  const viewport = deck.getViewports()[0];
  const route = state.route;
  pins.forEach((pin, i) => {
    if (!route || !viewport) {
      pin.hidden = true;
      return;
    }
    const [x, y] = viewport.project(i ? route.to : route.from);
    pin.hidden = false;
    pin.firstElementChild!.textContent = route.labels[i];
    pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
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
  // Phones have 3x screens; glowing lines look the same at 1.5x and cost a quarter of the pixels.
  useDevicePixels: Math.min(window.devicePixelRatio || 1, 1.5),
  onAfterRender: () => placePins(),
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
  home: () => deck.setProps({ initialViewState: initialView() }),
  zoom: () => state.zoom,
  // Where a place is on screen, in CSS pixels (for scripted demos and tests).
  project: (longitude: number, latitude: number) => deck.getViewports()[0]?.project([longitude, latitude]) ?? null,
  view: () => {
    const v = deck.getViewports()[0] as unknown as { longitude: number; latitude: number; zoom: number };
    return { longitude: v.longitude, latitude: v.latitude, zoom: v.zoom };
  },
  layerIds: () => layers().map((l) => l.id),
};

async function setExplore(on: boolean) {
  state.explore = on;
  ui.explore.setAttribute('aria-pressed', String(on));
  // On phones the search panel shrinks to the map controls, so the map has the screen.
  document.body.classList.toggle('exploring', on);
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

const TEXT_EVERY_MS = 250; // the clock and counts change four times a second, not every frame
let textAt = 0;

function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text; // an unchanged write still costs a layout
}

/** Clock, slider and "1,507 trains on the move at 20:08". */
function updateText(force = false) {
  const now = performance.now();
  if (!force && now - textAt < TEXT_EVERY_MS) return;
  textAt = now;
  const label = clockLabel(state.minute);
  setText(ui.clock, label);
  const slider = String(Math.floor(state.minute - WINDOW[0]));
  if (ui.time.value !== slider && document.activeElement !== ui.time) ui.time.value = slider;
  if (state.long) {
    const moving = activeTrips(state.long, state.minute) + (state.rest ? activeTrips(state.rest, state.minute) : 0);
    setText(ui.live, `${moving.toLocaleString('en-IN')} trains on the move at ${label}`);
  }
}

function render(force = false) {
  deck.setProps({ layers: layers() });
  updateText(force || !state.playing);
}

// Frame loop with a low-end fallback measured from real frame times.
// While someone types in the search, the map holds still: drawing frames competes with
// the keyboard on slower phones, and the keyboard covers the map anyway.
let typing = false;
const searchForm = document.querySelector<HTMLFormElement>('#search')!;
searchForm.addEventListener('focusin', (event) => {
  typing = (event.target as HTMLElement).tagName === 'INPUT';
});
searchForm.addEventListener('focusout', () => {
  typing = false;
});

// Touch devices draw at most 30 frames a second: the trails move slowly, so it looks the
// same, and it halves the work for the phone's GPU and battery.
const MIN_FRAME_MS = window.matchMedia('(pointer: coarse)').matches ? 1000 / 30 - 2 : 0;
let last = performance.now();
let slowFrames = 0;
function frame(now: number) {
  if (now - last < MIN_FRAME_MS) {
    requestAnimationFrame(frame);
    return;
  }
  const elapsed = now - last;
  last = now;
  if (state.playing && !typing) {
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
  const { zones, checked } = coverage(specials);
  const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(checked));
  ui.seasonText.textContent = `${running[0].season}: ${homeward} verified special trains from the big cities, from ${zones} railway zones' notices (checked ${day}). More may run.`;
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
  // Compile the one map shader while the train data downloads, not after it arrives.
  deck.setProps({ layers: [staticLines('warm-up', [[[0, 0], [0.001, 0]]], [0, 0, 0, 0], 1)] });
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
    // The animated map means the page is rarely idle, so give the idle wait a deadline.
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 500));
    idle(() => void warmSearch(), { timeout: 1000 });
  } catch (error) {
    ui.status.textContent = 'The train data could not be loaded. Please refresh the page.';
    console.error(error);
  }
  requestAnimationFrame(frame);
}

start();
