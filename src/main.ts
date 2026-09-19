import './style.css';
import { MapApp } from './app.ts';
import { attachInput } from './input.ts';
import type { MapData } from './mapdata.ts';
import { ICONS, roundButton } from './ui/icons.ts';

const LOADING_LINES = ['Painting crosswalks…', 'Planting street trees…', 'Waiting for the 7 train…', 'Mowing Sunnyside Gardens…'];

async function start() {
  const line = document.getElementById('loading-line')!;
  let i = 0;
  const ticker = window.setInterval(() => (line.textContent = LOADING_LINES[i++ % LOADING_LINES.length]), 700);

  const res = await fetch(`${import.meta.env.BASE_URL}data/sunnyside.json`);
  if (!res.ok) throw new Error(`Map data failed to load (${res.status})`);
  const data = (await res.json()) as MapData;

  const app = new MapApp(document.getElementById('map')!, data);
  attachInput(app, app.renderer.domElement, {});

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
    roundButton(ICONS.rotate, 'Rotate view (Q / E)', () => app.rotate(1)),
    roundButton(ICONS.home, 'Show all of Sunnyside', () => app.home()),
  );
  top.append(left, right);

  const plate = document.createElement('div');
  plate.className = 'panel title-plate';
  plate.innerHTML = `<div class="name">Sunnyside</div><div class="sub">Queens, New York</div>
    <div class="count"><span class="diamond"></span><span id="place-count">0 places so far</span></div>`;

  const credit = document.createElement('div');
  credit.className = 'credit';
  credit.innerHTML = 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

  ui.append(top, plate, credit);

  window.clearInterval(ticker);
  document.getElementById('loading')!.classList.add('done');
  if (import.meta.env.DEV) (window as unknown as { __app: MapApp }).__app = app;
}

start().catch((err) => {
  console.error(err);
  const line = document.getElementById('loading-line');
  if (line) line.textContent = 'Sorry, the map could not load. Please refresh.';
});
