import { Deck, type MapViewState, WebMercatorViewport } from '@deck.gl/core';
import { TripsLayer } from '@deck.gl/geo-layers';
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';

import { activeTrips, clockLabel, DAY, loadTrips, type TripBuffers, WINDOW } from './data';
import {
  arcPath,
  isHomeward,
  type Special,
  type SpecialTrip,
  specialTrips,
  summary,
} from './festival';
import './style.css';

const DATA = `${import.meta.env.BASE_URL}data/`;
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
  bengaluru: document.querySelector<HTMLButtonElement>('#bengaluru')!,
  legend: document.querySelector<HTMLParagraphElement>('#legend')!,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  minute: WINDOW[0] + 20 * 60, // open at 20:00, when the night trains are leaving
  playing: !reducedMotion,
  light: false,
  long: null as TripBuffers | null,
  rest: null as TripBuffers | null,
  states: null as unknown,
  festival: false,
  bengaluru: false,
  specials: [] as Special[],
  specialTrips: [] as SpecialTrip[],
};

// Mainland India plus the Northeast; islands may sit off the fitted view.
const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [68.1, 7.9],
  [97.4, 35.7],
];

/** Fit India into the space between the title and the control panel. */
function initialView(): MapViewState {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const title = document.querySelector('.title')!.getBoundingClientRect();
  const hud = document.querySelector('.hud')!.getBoundingClientRect();
  const stacked = width < 760; // panel sits under the map rather than beside it
  const padding = {
    top: Math.round(title.bottom + 8),
    bottom: Math.round(stacked ? height - hud.top + 8 : 40),
    left: Math.round(stacked ? 8 : hud.right + 16),
    right: 8,
  };
  const { longitude, latitude, zoom } = new WebMercatorViewport({ width, height }).fitBounds(
    INDIA_BOUNDS,
    { padding },
  );
  return { longitude, latitude, zoom, minZoom: Math.min(zoom, 3), maxZoom: 9 };
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
    widthMinPixels: width,
    capRounded: true,
    jointRounded: true,
    fadeTrail: true,
    opacity: state.festival ? 0.22 : 0.9,
    parameters: GLOW,
  });
}

function layers() {
  const out = [];
  if (state.states) {
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
  return out;
}

function inFocus(special: Special): boolean {
  return !state.bengaluru || special.oState === 'Karnataka';
}

function festivalLayers() {
  const homeward = state.specials.filter(isHomeward);
  const focused = homeward.filter(inFocus);
  return [
    // Every verified homeward special as a faint route, including those whose notice
    // gives no timings (they are drawn but never animated).
    new PathLayer<Special>({
      id: 'special-routes',
      data: homeward,
      getPath: (s) => arcPath(s.from, s.to),
      getColor: (s) => [...GOLD, inFocus(s) ? 70 : 18],
      widthMinPixels: 1,
      updateTriggers: { getColor: state.bengaluru },
    }),
    new TripsLayer<SpecialTrip>({
      id: 'special-trips',
      data: state.specialTrips.filter((t) => isHomeward(t.special) && inFocus(t.special)),
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
      data: focused,
      getPosition: (s) => s.to,
      getRadius: 3,
      radiusUnits: 'pixels',
      getFillColor: [...GOLD, 200],
    }),
  ];
}

const deck = new Deck({
  parent: document.querySelector<HTMLDivElement>('#map')!,
  initialViewState: initialView(),
  controller: { dragRotate: false, touchRotate: false },
  layers: [],
});

function render() {
  deck.setProps({ layers: layers() });
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

function festivalLegend(): string {
  const s = summary(state.specials);
  const focus = state.specials.filter((x) => isHomeward(x) && x.oState === 'Karnataka');
  if (state.bengaluru) {
    return `Gold: ${focus.length} verified festival specials leaving Bengaluru for home`;
  }
  return `Gold: ${s.homeward} verified Diwali–Chhath specials heading home`;
}

function setFestival(on: boolean) {
  state.festival = on;
  ui.festival.setAttribute('aria-pressed', String(on));
  ui.legend.textContent = on ? festivalLegend() : 'Each light is a train · 24 hours in 60 seconds';
  render();
}

function setBengaluru(on: boolean) {
  state.bengaluru = on;
  ui.bengaluru.setAttribute('aria-pressed', String(on));
  if (on && !state.festival) setFestival(true);
  // No camera move: Bengaluru's specials reach as far as Assam, so all of India stays in view.
  ui.legend.textContent = state.festival ? festivalLegend() : ui.legend.textContent;
  render();
}

function setPlaying(playing: boolean) {
  state.playing = playing;
  ui.play.textContent = playing ? 'Pause' : 'Play';
  ui.play.setAttribute('aria-pressed', String(playing));
}

ui.play.addEventListener('click', () => setPlaying(!state.playing));
ui.festival.addEventListener('click', () => setFestival(!state.festival));
ui.bengaluru.addEventListener('click', () => setBengaluru(!state.bengaluru));
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
    const [states, long] = await Promise.all([
      fetch(`${DATA}india-states.json`).then((r) => r.json()),
      loadTrips(`${DATA}trains-long.bin`),
    ]);
    state.states = states;
    state.long = long;
    render();
    const moving = activeTrips(long, state.minute);
    ui.status.textContent = reducedMotion ? 'Animation paused because reduced motion is on. Press Play to start.' : '';
    ui.summary.textContent =
      `The map animates ${long.length.toLocaleString('en-IN')} long-distance train runs from an open 2016 ` +
      `Indian Railways timetable across one day, compressed into 60 seconds. At 8 pm about ` +
      `${moving.toLocaleString('en-IN')} long-distance trains are on the move.`;
    const [rest, specials] = await Promise.all([
      loadTrips(`${DATA}trains-rest.bin`),
      fetch(`${DATA}specials-2026.json`).then((r) => r.json() as Promise<Special[]>),
    ]);
    state.rest = rest;
    state.specials = specials;
    state.specialTrips = specialTrips(specials);
    ui.festival.disabled = false;
    ui.bengaluru.disabled = false;
    render();
  } catch (error) {
    ui.status.textContent = 'The train data could not be loaded. Please refresh the page.';
    console.error(error);
  }
  requestAnimationFrame(frame);
}

start();
