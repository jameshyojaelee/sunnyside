import './style.css';
import { MapApp } from './app.ts';
import placesJson from './data/places.json';
import { makeProjection } from './geo.ts';
import { attachInput, type InputHandlers } from './input.ts';
import type { MapData } from './mapdata.ts';
import { validatePlaces, type Place } from './places.ts';
import { PlacesController } from './placesController.ts';
import { buildArch } from './render/arch.ts';
import { buildTrains } from './render/trains.ts';
import { PlaceCard } from './ui/card.ts';
import { setupMusic } from './ui/music.ts';
import { AboutPanel, closeSidePanels, PlacesList } from './ui/panels.ts';
import { ICONS, roundButton } from './ui/icons.ts';

const LOADING_LINES = ['Painting crosswalks…', 'Planting street trees…', 'Waiting for the 7 train…', 'Mowing Sunnyside Gardens…'];

async function loadPlaces(): Promise<Place[]> {
  // Dev-only test data: http://127.0.0.1:5173/?fixtures
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('fixtures')) {
    return (await import('../tests/fixtures/places.json')).default as Place[];
  }
  return placesJson as Place[];
}

function usable(places: Place[]): Place[] {
  const errors = validatePlaces(places);
  if (errors.length) console.warn('[places] problems in places.json:\n' + errors.join('\n'));
  const bad = new Set(errors.map((e) => e.match(/\(([^)]*)\)/)?.[1]));
  return places.filter((p) => !bad.has(p.id));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start() {
  window.__mapStarted = true;
  const line = document.getElementById('loading-line')!;
  let i = 0;
  const ticker = window.setInterval(() => (line.textContent = LOADING_LINES[i++ % LOADING_LINES.length]), 700);

  const res = await fetch(`${import.meta.env.BASE_URL}data/sunnyside.json`);
  if (!res.ok) throw new Error(`Map data failed to load (${res.status})`);
  const data = (await res.json()) as MapData;
  const proj = makeProjection(data.origin.lon, data.origin.lat);

  const app = new MapApp(document.getElementById('map')!, data);
  const ui = document.getElementById('ui')!;

  const top = document.createElement('div');
  top.className = 'topbar';
  const left = document.createElement('div');
  left.className = 'btn-group';
  const right = document.createElement('div');
  right.className = 'btn-group';
  right.append(
    roundButton(ICONS.minus, 'Zoom out', () => app.zoomAnimated(1 / 1.6)),
    roundButton(ICONS.plus, 'Zoom in', () => app.zoomAnimated(1.6)),
    roundButton(ICONS.rotateCcw, 'Rotate counter-clockwise (Q)', () => app.rotate(-1)),
    roundButton(ICONS.rotate, 'Rotate clockwise (E)', () => app.rotate(1)),
    roundButton(ICONS.home, 'Show all of Sunnyside', () => app.home()),
  );
  top.append(left, right);

  const plate = document.createElement('div');
  plate.className = 'panel title-plate';
  plate.innerHTML = `<div class="name">Sunnyside</div><div class="sub">Queens, New York</div>
    <div class="count"><svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.4-4.5-9.4-9.1C1.1 8.3 3.3 4.6 6.9 4.6c2.1 0 3.6 1.2 4.4 2.6.8-1.4 2.3-2.6 4.4-2.6 3.6 0 5.8 3.7 4.3 7.3C19.4 16.5 12 21 12 21z"/></svg><span id="place-count"></span></div>`;

  const credit = document.createElement('div');
  credit.className = 'credit';
  credit.innerHTML = 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

  ui.append(top, plate, credit);

  const card = new PlaceCard(ui, () => controller.onCardClosed());
  const controller = new PlacesController(app, proj, card, ui);

  // Landmarks and the 7 train. The arch sign uses the page font, so wait for it first, but never
  // hang on it: on a slow phone network the font request can stay pending forever.
  await Promise.race([document.fonts.load('900 54px Nunito').catch(() => undefined), wait(2500)]);
  controller.setLandmarks([
    {
      id: 'sunnyside-arch',
      name: 'Sunnyside Arch',
      description:
        "Sunnyside's welcome sign: an illuminated steel arch over 46th Street, just south of Queens Boulevard, with the neighborhood's name on a baby-blue panel.\n\nA local civic group put it up in 1983 to help the 46th Street shopping strip, and it has been restored several times since.",
      link: 'https://en.wikipedia.org/wiki/Sunnyside_Arch',
      arch: buildArch(data, proj),
    },
  ]);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const trains = buildTrains(data.viaduct, reducedMotion);
  app.scene.add(trains.group);
  if (!reducedMotion) app.addTicker(trains.update);
  const list = new PlacesList(ui, (id) => controller.selectPlace(id));
  const about = new AboutPanel(ui);
  left.append(
    roundButton(ICONS.places, 'Our places', () => list.toggle()),
    roundButton(ICONS.info, 'About this map', () => about.toggle()),
  );
  setupMusic(left);
  controller.onChange = (places) => {
    document.getElementById('place-count')!.textContent = `${places.length} ${places.length === 1 ? 'place' : 'places'} so far`;
    list.setPlaces(places);
  };
  controller.setPlaces(usable(await loadPlaces()));

  const browse: InputHandlers = {
    onTap: (x, y) => controller.tap(x, y),
    onHover: (x, y) => controller.hover(x, y),
    onLeave: () => controller.clearHover(),
    onEscape: () => {
      closeSidePanels();
      controller.deselect();
    },
  };
  let input = browse;
  attachInput(app, app.renderer.domElement, {
    onTap: (x, y, t) => input.onTap?.(x, y, t),
    onHover: (x, y) => input.onHover?.(x, y),
    onLeave: () => input.onLeave?.(),
    onEscape: () => input.onEscape?.(),
  });

  // Build mode exists only on the local dev server; this branch is removed from production builds.
  if (import.meta.env.DEV) {
    const { setupBuildMode } = await import('./build/buildMode.ts');
    await setupBuildMode({ app, controller, proj, data, ui, buttonHost: left, setInput: (h) => (input = h ?? browse) });
  }

  window.clearInterval(ticker);
  document.getElementById('loading')!.classList.add('done');

  if (import.meta.hot) {
    // Build mode rewrites places.json; swap buildings in place instead of reloading the page.
    import.meta.hot.accept('./data/places.json', (mod) => {
      if (mod && !new URLSearchParams(location.search).has('fixtures')) controller.setPlaces(usable(mod.default as Place[]));
    });
  }
  if (import.meta.env.DEV) Object.assign(window, { __app: app, __places: controller });
}

function loadFailed(what: string) {
  const line = document.getElementById('loading-line');
  if (line) line.textContent = `Sorry, the map could not load (${what}). Please refresh.`;
  document.getElementById('loading-retry')?.removeAttribute('hidden');
}

start().catch((err: unknown) => {
  console.error(err);
  loadFailed(err instanceof Error ? err.message : 'unknown error');
});
// A WebGL failure after startup (phones drop the context when memory runs short) would otherwise
// leave a frozen map with no explanation.
window.addEventListener('unhandledrejection', (e) => console.error('[sunnyside]', e.reason));
