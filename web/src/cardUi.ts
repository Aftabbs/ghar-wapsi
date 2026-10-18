// The "Make your card" dialog: choose a city and a home district, preview, share.

import {
  cardFacts,
  drawCard,
  type Migration,
  type Narrations,
  type RailTravel,
  type RouteData,
} from './card';
import type { Special } from './festival';

interface Inputs {
  dataUrl: string;
  specials: () => Special[];
  states: () => unknown;
  siteUrl: string;
  onCardMade: (cityId: string, homeState: string) => void;
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

export function setupCard(inputs: Inputs) {
  const open = $<HTMLButtonElement>('#make-card');
  const dialog = $<HTMLDialogElement>('#card-dialog');
  const city = $<HTMLSelectElement>('#card-city');
  const state = $<HTMLSelectElement>('#card-state');
  const district = $<HTMLSelectElement>('#card-district');
  const canvas = $<HTMLCanvasElement>('#card-canvas');
  const share = $<HTMLButtonElement>('#card-share');
  const download = $<HTMLAnchorElement>('#card-download');
  const hint = $<HTMLParagraphElement>('#card-hint');
  const close = $<HTMLButtonElement>('#card-close');
  const narration = $<HTMLElement>('#card-narration');
  const narrationText = $<HTMLParagraphElement>('#card-narration-en');
  const narrationHindi = $<HTMLParagraphElement>('#card-narration-hi');

  let data: {
    routes: RouteData;
    migration: Migration;
    travel: RailTravel;
    narrations: Narrations;
    trains: Map<string, string>;
  } | null = null;
  let blob: Blob | null = null;

  async function load() {
    if (data) return data;
    const get = (name: string) => fetch(`${inputs.dataUrl}${name}`).then((r) => r.json());
    const [routes, migration, travel, meta, narrations] = await Promise.all([
      get('routes.json'),
      get('migration-2011.json'),
      get('rail-travel-2023.json'),
      get('trains.meta.json'),
      // Optional: the card works without the AI-written story lines.
      get('narrations.json').catch(() => ({ model: '', cards: {} })),
    ]);
    data = {
      routes,
      migration,
      travel,
      narrations,
      trains: new Map((meta as { n: string; name: string }[]).map((t) => [t.n, t.name])),
    };
    city.replaceChildren(
      ...Object.entries(routes.cities as RouteData['cities']).map(([id, c]) => new Option(c.name, id)),
    );
    const states = [...new Set(Object.values(routes.districts as RouteData['districts']).map((d) => d[4]))].sort();
    state.replaceChildren(new Option('Choose your home state', ''), ...states.map((s) => new Option(s, s)));
    return data;
  }

  function fillDistricts() {
    if (!data) return;
    const options = Object.entries(data.routes.districts)
      .filter(([, d]) => d[4] === state.value)
      .sort((a, b) => a[1][0].localeCompare(b[1][0]))
      .map(([code, d]) => new Option(d[0], code));
    district.replaceChildren(new Option('Choose your home district', ''), ...options);
    district.disabled = !options.length;
  }

  async function render() {
    blob = null;
    share.disabled = true;
    download.hidden = true;
    if (!data || !district.value) {
      hint.textContent = 'Pick where you live and where home is.';
      return;
    }
    await document.fonts.ready;
    const facts = cardFacts(city.value, district.value, { ...data, specials: inputs.specials() });
    drawCard(canvas, facts, inputs.states() as never, inputs.siteUrl);
    const story = facts.narration ? `${facts.narration.en} ${facts.narration.hi} ` : '';
    canvas.setAttribute(
      'aria-label',
      `Card: ${facts.title}. ${story}${facts.lines.map((l) => `${l.text} (${l.source})`).join('. ')}`,
    );
    narration.hidden = !facts.narration;
    narrationText.textContent = facts.narration ? facts.narration.en : '';
    narrationHindi.textContent = facts.narration ? facts.narration.hi : '';
    // Make the file before the tap: some browsers refuse to share once an await
    // has passed inside the click handler.
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    download.href = URL.createObjectURL(blob);
    download.download = `ghar-wapsi-${city.value}-${district.value}.png`;
    download.hidden = false;
    const file = new File([blob], download.download, { type: 'image/png' });
    share.disabled = !(navigator.canShare && navigator.canShare({ files: [file] }));
    hint.textContent = share.disabled
      ? 'Download the card, or press and hold it to save.'
      : 'Share it, or download it.';
    inputs.onCardMade(city.value, data.routes.districts[district.value][4]);
  }

  open.addEventListener('click', async () => {
    dialog.showModal();
    hint.textContent = 'Loading…';
    await load();
    hint.textContent = 'Pick where you live and where home is.';
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => open.focus());
  city.addEventListener('change', render);
  state.addEventListener('change', () => {
    fillDistricts();
    render();
  });
  district.addEventListener('change', render);
  share.addEventListener('click', () => {
    if (!blob) return;
    const file = new File([blob], download.download, { type: 'image/png' });
    navigator
      .share({ files: [file], title: 'Ghar Wapsi', text: `My journey home · ${inputs.siteUrl}` })
      .catch(() => {
        /* the person closed the share sheet */
      });
  });
}
