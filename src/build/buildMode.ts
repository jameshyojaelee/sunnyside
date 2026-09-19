// Build mode: add, edit and delete places by clicking real buildings. Dev server only; main.ts
// loads this module behind import.meta.env.DEV so it never ships to visitors.
import * as THREE from 'three';
import type { MapApp } from '../app.ts';
import { CATEGORIES, CATEGORY_IDS, type Category } from '../data/categories.ts';
import { chooseFacadeEdge, prepareFootprint } from '../facade.ts';
import { distToSegment, pointInRing, projectOnSegment, type Projection, type Pt } from '../geo.ts';
import type { InputHandlers } from '../input.ts';
import type { DevBuilding, DevPoi, MapData } from '../mapdata.ts';
import type { Place } from '../places.ts';
import type { PlacesController } from '../placesController.ts';
import { wallGeometry } from '../render/buildings.ts';
import { buildStrips } from '../render/strips.ts';
import { ICONS, roundButton } from '../ui/icons.ts';

const CELL = 50;
const MAX_PHOTOS = 4;

interface Ctx {
  app: MapApp;
  controller: PlacesController;
  proj: Projection;
  data: MapData;
  ui: HTMLElement;
  buttonHost: HTMLElement;
  setInput(h: InputHandlers | null): void;
}

interface Selection {
  ring: Pt[];
  storefront: Pt;
  facadeEdge: number;
  facadeManual: boolean;
  osmBuildingId: string;
  height: number;
  editing?: Place;
  photos: string[];
  newPhotos: File[];
}

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'place';
}

const round7 = (v: number) => Math.round(v * 1e7) / 1e7;
const html = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Resize to at most 1600 px and re-encode as JPEG; re-encoding also drops EXIF/GPS metadata. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.85));
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${r.status}`);
  return j;
}

export async function setupBuildMode(ctx: Ctx) {
  const { app, controller, proj, data, ui } = ctx;
  let active = false;
  let buildings: Array<DevBuilding & { ring: Pt[] }> = [];
  let pois: DevPoi[] = [];
  const grid = new Map<string, number[]>();
  let outlines: THREE.LineSegments | null = null;
  const overlay = new THREE.Group();
  overlay.name = 'build-overlay';
  app.scene.add(overlay);
  let hoverLine: THREE.LineLoop | null = null;
  let ghost: THREE.Group | null = null;
  let sel: Selection | null = null;

  // Roads with names, for street tooltips and choosing the storefront wall.
  const namedRoads = data.roads.filter((r) => r.l === 0 && r.n);
  const roadAt = (x: number, y: number, maxDist: number) => {
    let best: string | undefined;
    let bestD = maxDist;
    for (const r of namedRoads)
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const d = distToSegment(x, y, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]) - r.w / 2;
        if (d < bestD) {
          bestD = d;
          best = r.n;
        }
      }
    return best;
  };

  // Start loading outlines now so the search box is ready (and focused) the moment Build opens;
  // otherwise early keystrokes would hit the map's rotate/zoom shortcuts.
  const ready = loadBuildingsLater();

  // ---- UI ----------------------------------------------------------------------------------
  const button = roundButton(ICONS.build, 'Build mode (add a place)', () => toggle());
  button.setAttribute('aria-pressed', 'false');
  ctx.buttonHost.append(button);

  const panel = document.createElement('section');
  panel.className = 'panel build-panel';
  panel.hidden = true;
  ui.append(panel);

  const tip = document.createElement('div');
  tip.className = 'panel hover-label build-tip';
  tip.hidden = true;
  ui.append(tip);

  function showHome() {
    panel.innerHTML = `
      <h2>Build mode</h2>
      <p class="hint">Click the building where the shop's front door is, or search for it. Click a building with a heart to edit it.</p>
      <input class="search" type="search" placeholder="Shop name or address, e.g. 46-10 Queens Blvd" aria-label="Search" />
      <div class="results"></div>
      <p class="hint small">Saving writes <code>src/data/places.json</code>. Run <code>npm run publish-places</code> to put changes online.</p>`;
    const input = panel.querySelector<HTMLInputElement>('.search')!;
    const results = panel.querySelector<HTMLDivElement>('.results')!;
    let t = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = window.setTimeout(() => search(input.value, results), 150);
    });
    input.focus();
  }

  function search(q: string, results: HTMLElement) {
    results.replaceChildren();
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return;
    const hits: Array<{ label: string; sub: string; x: number; y: number; name?: string }> = [];
    for (const p of pois) if (p.n.toLowerCase().includes(needle)) hits.push({ label: p.n, sub: p.a ?? p.t, x: p.x, y: p.y, name: p.n });
    for (const b of buildings) {
      if (hits.length > 12) break;
      if (b.a?.toLowerCase().includes(needle)) {
        const c = b.ring.reduce((s, p) => [s[0] + p[0] / b.ring.length, s[1] + p[1] / b.ring.length], [0, 0]);
        hits.push({ label: b.a, sub: 'building', x: c[0], y: c[1] });
      }
    }
    for (const h of hits.slice(0, 10)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'result';
      b.innerHTML = `<strong>${html(h.label)}</strong><small>${html(h.sub)}</small>`;
      b.addEventListener('click', () => {
        app.animateTo({ tx: h.x, ty: h.y, scale: Math.max(app.view.scale, 6) }, 600);
        const idx = buildingAt(h.x, h.y) ?? nearestBuilding(h.x, h.y, 15);
        if (idx !== null) selectBuilding(idx, [h.x, h.y], h.name);
      });
      results.append(b);
    }
    const web = document.createElement('button');
    web.type = 'button';
    web.className = 'link-btn';
    web.textContent = hits.length ? 'Not it? Search the web map' : 'No match here. Search the web map';
    web.addEventListener('click', async () => {
      web.textContent = 'Searching…';
      try {
        const r = await api<Array<{ name: string; lon: number; lat: number }>>(`/__build/geocode?q=${encodeURIComponent(q)}`);
        web.remove();
        if (!r.length) results.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Nothing found in Sunnyside.' }));
        for (const h of r) {
          const [x, y] = proj.toLocal(h.lon, h.lat);
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'result';
          b.innerHTML = `<strong>${html(h.name.split(',').slice(0, 2).join(','))}</strong><small>from OpenStreetMap search</small>`;
          b.addEventListener('click', () => app.animateTo({ tx: x, ty: y, scale: Math.max(app.view.scale, 6) }, 600));
          results.append(b);
        }
      } catch (e) {
        web.textContent = `Search failed: ${(e as Error).message}`;
      }
    });
    results.append(web);
  }

  function showForm() {
    if (!sel) return;
    const s = sel;
    const p = s.editing;
    panel.innerHTML = `
      <h2>${p ? 'Edit place' : 'New place'}</h2>
      <form novalidate>
        <label>Name <input name="name" required maxlength="80" /></label>
        <label>Category <select name="category">${CATEGORY_IDS.map((c) => `<option value="${c}">${CATEGORIES[c].label}</option>`).join('')}</select></label>
        <label>What we think <textarea name="description" rows="6" required placeholder="Our favorite order, why we go, who we go with…"></textarea></label>
        <label>Address <input name="address" /></label>
        <label>First visited <input name="visited" type="date" /></label>
        <label>Link <input name="link" type="url" placeholder="https://" /></label>
        <label>Photos (up to ${MAX_PHOTOS}) <input name="photos" type="file" accept="image/*" multiple /></label>
        <div class="thumbs"></div>
        <p class="error" role="alert"></p>
        <div class="actions">
          <button type="submit" class="primary">Save</button>
          <button type="button" data-act="cancel">Cancel</button>
          ${p ? '<button type="button" data-act="delete" class="danger">Delete</button>' : ''}
        </div>
      </form>`;
    const f = panel.querySelector('form')!;
    const field = <T extends HTMLElement = HTMLInputElement>(n: string) => f.querySelector<T>(`[name="${n}"]`)!;
    field('name').value = p?.name ?? '';
    field<HTMLSelectElement>('category').value = p?.category ?? 'restaurant';
    field<HTMLTextAreaElement>('description').value = p?.description ?? '';
    field('address').value = p?.address ?? '';
    field('visited').value = p?.visited ?? '';
    field('link').value = p?.link ?? '';
    if (!p && pendingName) field('name').value = pendingName;

    drawGhost();

    const thumbs = f.querySelector<HTMLDivElement>('.thumbs')!;
    const renderThumbs = () => {
      thumbs.replaceChildren();
      const add = (src: string, remove: () => void) => {
        const d = document.createElement('div');
        d.className = 'thumb';
        const img = document.createElement('img');
        img.src = src;
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.setAttribute('aria-label', 'Remove photo');
        x.addEventListener('click', () => {
          remove();
          renderThumbs();
        });
        d.append(img, x);
        thumbs.append(d);
      };
      s.photos.forEach((ph, i) => add(`${import.meta.env.BASE_URL}${ph}`, () => s.photos.splice(i, 1)));
      s.newPhotos.forEach((file, i) => add(URL.createObjectURL(file), () => s.newPhotos.splice(i, 1)));
    };
    renderThumbs();
    field('photos').addEventListener('change', () => {
      const files = [...(field('photos').files ?? [])];
      s.newPhotos.push(...files.slice(0, Math.max(0, MAX_PHOTOS - s.photos.length - s.newPhotos.length)));
      field('photos').value = '';
      renderThumbs();
    });

    const error = f.querySelector<HTMLParagraphElement>('.error')!;
    f.querySelector('[data-act="cancel"]')!.addEventListener('click', () => clearSelection());
    const del = f.querySelector<HTMLButtonElement>('[data-act="delete"]');
    del?.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'Really delete?';
        return;
      }
      try {
        await api(`/__build/places/${p!.id}`, { method: 'DELETE' });
        clearSelection();
      } catch (e) {
        error.textContent = (e as Error).message;
      }
    });

    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      const name = field('name').value.trim();
      const description = field<HTMLTextAreaElement>('description').value.trim();
      if (!name || !description) {
        error.textContent = 'Name and "What we think" are required.';
        return;
      }
      const save = f.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        const id = p?.id ?? uniqueSlug(name);
        // New places: pick the awning wall from the final address (edits keep their wall).
        if (!s.facadeManual) s.facadeEdge = chooseFacadeEdge(s.ring, s.storefront, namedRoads, field('address').value);
        const photos = [...s.photos];
        for (const [i, file] of s.newPhotos.entries()) {
          const blob = await shrinkPhoto(file);
          const r = await api<{ path: string }>(`/__build/photos/${id}/p${Date.now()}-${i}.jpg`, { method: 'POST', body: blob });
          photos.push(r.path);
        }
        const opt = (v: string) => v.trim() || undefined;
        // Start from the saved place so fields the form doesn't show (look, lot) survive an edit.
        const place: Place = {
          ...p,
          id,
          name,
          category: field<HTMLSelectElement>('category').value as Category,
          description,
          address: opt(field('address').value),
          visited: opt(field('visited').value),
          link: opt(field('link').value),
          photos: photos.length ? photos : undefined,
          osmBuildingId: s.osmBuildingId,
          footprint: s.ring.map(([x, y]) => proj.toLonLat(x, y).map(round7) as [number, number]),
          height: s.height,
          storefront: proj.toLonLat(...s.storefront).map(round7) as [number, number],
          facadeEdge: s.facadeEdge,
        };
        await api('/__build/places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(place) });
        clearSelection();
        // The page picks up the new places.json through hot reload; open the card once it lands.
        for (let k = 0; k < 30 && !controller.places.some((q) => q.id === id); k++) await new Promise((r) => setTimeout(r, 100));
        controller.selectPlace(id);
      } catch (e) {
        error.textContent = (e as Error).message;
        save.disabled = false;
        save.textContent = 'Save';
      }
    });
    field('name').focus();
  }

  const uniqueSlug = (name: string) => {
    const base = slugify(name);
    let id = base;
    for (let n = 2; controller.places.some((q) => q.id === id); n++) id = `${base}-${n}`;
    return id;
  };

  // ---- Buildings, picking, overlays ----------------------------------------------------------
  function loadBuildingsLater(): Promise<void> {
    return new Promise((resolve) => setTimeout(() => loadBuildings().then(resolve, () => resolve()), 0));
  }

  async function loadBuildings() {
    if (buildings.length) return;
    const [bs, ps] = await Promise.all([api<DevBuilding[]>('/__build/buildings'), api<DevPoi[]>('/__build/pois')]);
    pois = ps;
    buildings = bs.map((b) => {
      const ring: Pt[] = [];
      for (let i = 0; i < b.r.length; i += 2) ring.push([b.r[i], b.r[i + 1]]);
      return { ...b, ring };
    });
    const seg: number[] = [];
    buildings.forEach((b, i) => {
      const xs = b.ring.map((p) => p[0]);
      const ys = b.ring.map((p) => p[1]);
      for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++)
        for (let gy = Math.floor(Math.min(...ys) / CELL); gy <= Math.floor(Math.max(...ys) / CELL); gy++) {
          const k = `${gx},${gy}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
        }
      b.ring.forEach((p, j) => {
        const q = b.ring[(j + 1) % b.ring.length];
        seg.push(p[0], p[1], 0.2, q[0], q[1], 0.2);
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    outlines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }));
    outlines.renderOrder = 4;
    outlines.frustumCulled = false;
  }

  const buildingAt = (x: number, y: number): number | null => {
    for (const i of grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []) if (pointInRing(x, y, buildings[i].ring)) return i;
    return null;
  };
  const nearestBuilding = (x: number, y: number, max: number): number | null => {
    let best: number | null = null;
    let bestD = max;
    for (let gx = -1; gx <= 1; gx++)
      for (let gy = -1; gy <= 1; gy++)
        for (const i of grid.get(`${Math.floor(x / CELL) + gx},${Math.floor(y / CELL) + gy}`) ?? []) {
          const r = buildings[i].ring;
          for (let j = 0; j < r.length; j++) {
            const a = r[j];
            const b = r[(j + 1) % r.length];
            const d = distToSegment(x, y, a[0], a[1], b[0], b[1]);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
    return best;
  };

  const ringLine = (ring: Pt[], color: string, z: number) => {
    const g = new THREE.BufferGeometry().setFromPoints(ring.map(([x, y]) => new THREE.Vector3(x, y, z)));
    const l = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, depthWrite: false }));
    l.renderOrder = 6;
    l.frustumCulled = false;
    return l;
  };

  function setHoverRing(ring: Pt[] | null) {
    if (hoverLine) {
      overlay.remove(hoverLine);
      hoverLine.geometry.dispose();
      hoverLine = null;
    }
    if (ring) overlay.add((hoverLine = ringLine(ring, '#ffe45c', 0.3)));
    app.requestRender();
  }

  let pendingName: string | undefined;

  function selectBuilding(i: number, click: Pt, poiName?: string) {
    const b = buildings[i];
    const ring = prepareFootprint(b.ring);
    let storefront = click;
    if (!pointInRing(click[0], click[1], ring)) {
      // Snap a point just outside (e.g. a shop node on the sidewalk) onto the nearest wall.
      let best = { d: Infinity, p: click };
      ring.forEach((a, j) => {
        const c = ring[(j + 1) % ring.length];
        const t = projectOnSegment(click[0], click[1], a[0], a[1], c[0], c[1]);
        const p: Pt = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
        const d = Math.hypot(p[0] - click[0], p[1] - click[1]);
        if (d < best.d) best = { d, p };
      });
      storefront = best.p;
    }
    const address = b.a ?? pois.find((p) => p.n === poiName)?.a;
    sel = {
      ring,
      storefront,
      facadeEdge: chooseFacadeEdge(ring, storefront, namedRoads, address),
      facadeManual: false,
      osmBuildingId: b.id,
      height: Math.round((b.h ?? (b.lv ? b.lv * 3 : 9)) * 10) / 10,
      photos: [],
      newPhotos: [],
    };
    pendingName = poiName;
    showForm();
    if (address) (panel.querySelector('[name="address"]') as HTMLInputElement).value = address;
  }

  function editPlace(p: Place) {
    const ring = p.footprint.map(([lon, lat]) => proj.toLocal(lon, lat));
    sel = {
      ring,
      storefront: proj.toLocal(...p.storefront),
      facadeEdge: p.facadeEdge ?? 0,
      facadeManual: p.facadeEdge !== undefined,
      osmBuildingId: p.osmBuildingId,
      height: p.height,
      editing: p,
      photos: [...(p.photos ?? [])],
      newPhotos: [],
    };
    pendingName = undefined;
    showForm();
  }

  function drawGhost() {
    if (ghost) {
      overlay.remove(ghost);
      ghost.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    ghost = null;
    if (!sel) return;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(wallGeometry(sel.ring, sel.height), mat));
    const roof = new THREE.ShapeGeometry(new THREE.Shape(sel.ring.map(([x, y]) => new THREE.Vector2(x, y))));
    roof.translate(0, 0, sel.height);
    g.add(new THREE.Mesh(roof, mat));
    const a = sel.ring[sel.facadeEdge];
    const b = sel.ring[(sel.facadeEdge + 1) % sel.ring.length];
    const wall = new THREE.Mesh(buildStrips([{ p: [a[0], a[1], b[0], b[1]], hw: 0.9 }], 0.25, 6), new THREE.MeshBasicMaterial({ color: '#ff9f1c', depthWrite: false }));
    wall.renderOrder = 6;
    g.add(wall);
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3, 12), new THREE.MeshLambertMaterial({ color: '#ff5a36' }));
    pin.rotation.x = -Math.PI / 2;
    pin.position.set(sel.storefront[0], sel.storefront[1], 1.5);
    g.add(pin);
    g.traverse((o) => (o.frustumCulled = false));
    overlay.add((ghost = g));
    app.requestRender();
  }

  function clearSelection() {
    sel = null;
    drawGhost();
    if (active) showHome();
  }

  // ---- Input while building ------------------------------------------------------------------
  const handlers: InputHandlers = {
    onHover(sx, sy) {
      const [x, y] = app.screenToGround(sx, sy);
      const place = controller.placeAt(sx, sy);
      const i = place ? null : buildingAt(x, y);
      setHoverRing(i !== null ? buildings[i].ring : null);
      const street = roadAt(x, y, 4);
      const parts = place ? [`Edit ${place.name}`] : i !== null ? [buildings[i].a ?? 'Building', street ? `near ${street}` : ''] : [street ?? ''];
      const text = parts.filter(Boolean);
      tip.hidden = !text.length;
      if (text.length) {
        tip.innerHTML = `${html(text[0])}${text[1] ? `<small>${html(text[1])}</small>` : ''}`;
        tip.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy - 14)}px) translate(-50%, -100%)`;
      }
      app.renderer.domElement.classList.toggle('pointing', !!place || i !== null);
    },
    onLeave() {
      tip.hidden = true;
      setHoverRing(null);
    },
    onTap(sx, sy) {
      const place = controller.placeAt(sx, sy);
      if (place) return editPlace(place);
      const [x, y] = app.screenToGround(sx, sy);
      const i = buildingAt(x, y);
      if (i !== null) selectBuilding(i, [x, y]);
    },
    onEscape() {
      if (sel) clearSelection();
      else toggle();
    },
  };

  async function toggle() {
    active = !active;
    button.setAttribute('aria-pressed', String(active));
    if (active) {
      controller.deselect();
      controller.clearHover();
      panel.hidden = false;
      panel.innerHTML = '<h2>Build mode</h2><p class="hint">Loading buildings…</p>';
      try {
        await ready;
        await loadBuildings();
      } catch (e) {
        panel.innerHTML = `<h2>Build mode</h2><p class="error">Could not load buildings: ${html((e as Error).message)}</p>`;
        return;
      }
      if (outlines) overlay.add(outlines);
      ctx.setInput(handlers);
      showHome();
    } else {
      sel = null;
      drawGhost();
      if (outlines) overlay.remove(outlines);
      setHoverRing(null);
      tip.hidden = true;
      panel.hidden = true;
      ctx.setInput(null);
    }
    app.requestRender();
  }
}
