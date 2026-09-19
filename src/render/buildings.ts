import * as THREE from 'three';
import { CATEGORIES, type Category } from '../data/categories.ts';
import { awningSpan, nearestEdge, separateSpans } from '../facade.ts';
import { distToRing, pointInRing, ringCentroid, type Pt } from '../geo.ts';
import type { Place } from '../places.ts';
import { buildLot, pickupSpot, type Lot, type LotEnv } from './lot.ts';
import { buildStrips } from './strips.ts';

const BAY = 3.0; // meters per window column
const FLOOR = 3.2; // meters per floor
const WALL_COLORS = ['#a4563f', '#8e4a36', '#c9a57a', '#d7c6a2', '#b98b62', '#9c9a94', '#c4a15e'];

export interface Storefront {
  place: Place;
  /** Awning center, world meters. */
  point: THREE.Vector3;
}

export interface PlaceBuilding {
  key: string;
  places: Place[];
  ring: Pt[];
  height: number;
  centroid: Pt;
  group: THREE.Group;
  storefronts: Storefront[];
  setHighlight(on: boolean): void;
  /** Extra ground a tree must not stand on (parking lot, drive-thru lane). */
  blocksTree?(x: number, y: number): boolean;
}

const textureCache = new Map<string, THREE.Texture>();
function cachedTexture(key: string, draw: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void, w: number, h: number) {
  let t = textureCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, c);
    t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    textureCache.set(key, t);
  }
  return t;
}

/** One window bay on a wall of the given color (repeats across the wall). */
function windowTexture(wall: string) {
  return cachedTexture(
    `win:${wall}`,
    (ctx) => {
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, 64, 64);
      // Faint brick courses.
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (let y = 3; y < 64; y += 6) ctx.fillRect(0, y, 64, 1);
      // Window: light frame, glass with a sky reflection, sill.
      ctx.fillStyle = '#ece6d6';
      ctx.fillRect(17, 13, 30, 34);
      const g = ctx.createLinearGradient(0, 16, 0, 44);
      g.addColorStop(0, '#6f8db3');
      g.addColorStop(1, '#2d3d58');
      ctx.fillStyle = g;
      ctx.fillRect(20, 16, 24, 28);
      ctx.fillStyle = '#ece6d6';
      ctx.fillRect(31, 16, 2, 28);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(15, 47, 34, 3);
    },
    64,
    64,
  );
}

function awningTexture(color: string, solid = false) {
  return cachedTexture(
    `awning:${color}:${solid}`,
    (ctx) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 32, 8);
      ctx.fillStyle = solid ? 'rgba(255,255,255,0.18)' : '#f4efe2';
      if (solid) ctx.fillRect(0, 0, 32, 1);
      else ctx.fillRect(16, 0, 16, 8);
    },
    32,
    8,
  );
}

/** Fast-food wall bay: glass storefront below, cream stucco, a colored band along the roofline. */
function fastFoodTexture(color: string) {
  return cachedTexture(
    `fastfood:${color}`,
    (ctx) => {
      ctx.fillStyle = '#eee3cc';
      ctx.fillRect(0, 0, 64, 128);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 26);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(0, 26, 64, 2);
      const g = ctx.createLinearGradient(0, 70, 0, 122);
      g.addColorStop(0, '#7d9cc2');
      g.addColorStop(1, '#2f405c');
      ctx.fillStyle = '#d9d4c6';
      ctx.fillRect(3, 66, 58, 58);
      ctx.fillStyle = g;
      ctx.fillRect(6, 69, 52, 53);
      ctx.fillStyle = '#d9d4c6';
      ctx.fillRect(30, 69, 3, 53);
    },
    64,
    128,
  );
}

/** Sign board: category color with a simple white pictogram. */
function signTexture(category: Category) {
  const t = cachedTexture(
    `sign:${category}`,
    (ctx) => {
      ctx.fillStyle = '#f4efe2';
      ctx.fillRect(0, 0, 128, 32);
      ctx.fillStyle = CATEGORIES[category].color;
      ctx.fillRect(3, 3, 122, 26);
      ctx.fillStyle = ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      drawPictogram(ctx, category, 64, 16);
    },
    128,
    32,
  );
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function drawPictogram(ctx: CanvasRenderingContext2D, category: Category, cx: number, cy: number) {
  ctx.beginPath();
  switch (category) {
    case 'coffee':
      ctx.rect(cx - 8, cy - 6, 13, 13);
      ctx.moveTo(cx + 5, cy - 3);
      ctx.arc(cx + 7, cy + 1, 4, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      return;
    case 'bakery':
      ctx.ellipse(cx, cy + 1, 14, 7, 0, 0, Math.PI * 2);
      ctx.moveTo(cx - 5, cy - 4);
      ctx.lineTo(cx - 2, cy + 5);
      ctx.moveTo(cx + 2, cy - 5);
      ctx.lineTo(cx + 5, cy + 4);
      ctx.stroke();
      return;
    case 'restaurant':
      ctx.moveTo(cx - 6, cy - 9);
      ctx.lineTo(cx - 6, cy + 9);
      ctx.moveTo(cx - 10, cy - 9);
      ctx.lineTo(cx - 10, cy - 2);
      ctx.lineTo(cx - 2, cy - 2);
      ctx.lineTo(cx - 2, cy - 9);
      ctx.moveTo(cx + 6, cy + 9);
      ctx.lineTo(cx + 6, cy - 9);
      ctx.quadraticCurveTo(cx + 12, cy - 4, cx + 6, cy + 1);
      ctx.stroke();
      return;
    case 'bar':
      ctx.moveTo(cx - 9, cy - 8);
      ctx.lineTo(cx + 9, cy - 8);
      ctx.lineTo(cx, cy + 1);
      ctx.closePath();
      ctx.moveTo(cx, cy + 1);
      ctx.lineTo(cx, cy + 8);
      ctx.moveTo(cx - 5, cy + 9);
      ctx.lineTo(cx + 5, cy + 9);
      ctx.stroke();
      return;
    case 'grocery':
      ctx.arc(cx, cy + 2, 8, 0, Math.PI * 2);
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx + 3, cy - 10);
      ctx.stroke();
      return;
    case 'shop':
      ctx.rect(cx - 9, cy - 4, 18, 13);
      ctx.moveTo(cx - 4, cy - 4);
      ctx.arc(cx, cy - 4, 4, Math.PI, 0);
      ctx.stroke();
      return;
    case 'service':
      ctx.arc(cx - 5, cy - 4, 4, 0, Math.PI * 2);
      ctx.moveTo(cx - 2, cy - 1);
      ctx.lineTo(cx + 9, cy + 10);
      ctx.stroke();
      return;
    default:
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5;
        ctx.lineTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9);
      }
      ctx.closePath();
      ctx.stroke();
  }
}

const UNIT = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** A quad from four corners, pushed as two triangles with a shared normal and UVs. */
function pushQuad(pos: number[], nrm: number[], uv: number[], c: THREE.Vector3[], n: THREE.Vector3, uvs: number[][]) {
  for (const k of [0, 1, 2, 0, 2, 3]) {
    pos.push(c[k].x, c[k].y, c[k].z);
    nrm.push(n.x, n.y, n.z);
    uv.push(uvs[k][0], uvs[k][1]);
  }
}

function geometry(pos: number[], nrm: number[], uv: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Outward-facing wall quads for a counter-clockwise ring, with window UVs. Exported for tests. */
export function wallGeometry(ring: Pt[], height: number, floorCount?: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const floors = floorCount ?? Math.max(1, Math.round(height / FLOOR));
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) continue;
    const n = new THREE.Vector3((b[1] - a[1]) / len, -(b[0] - a[0]) / len, 0);
    const bays = Math.max(1, Math.round(len / BAY));
    pushQuad(
      pos,
      nrm,
      uv,
      [new THREE.Vector3(a[0], a[1], 0), new THREE.Vector3(b[0], b[1], 0), new THREE.Vector3(b[0], b[1], height), new THREE.Vector3(a[0], a[1], height)],
      n,
      [
        [0, 0],
        [bays, 0],
        [bays, floors],
        [0, floors],
      ],
    );
  }
  return geometry(pos, nrm, uv);
}

/** Ground shadow of an extruded footprint: footprint, its shifted copy, and the swept walls. */
export function shadowGeometry(ring: Pt[], offset: THREE.Vector2): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (p: Pt[]) => {
    const faces = THREE.ShapeUtils.triangulateShape(
      p.map(([x, y]) => new THREE.Vector2(x, y)),
      [],
    );
    for (const f of faces) for (const k of f) pos.push(p[k][0], p[k][1], 0);
  };
  tri(ring);
  tri(ring.map(([x, y]) => [x + offset.x, y + offset.y] as Pt));
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const a2 = [a[0] + offset.x, a[1] + offset.y];
    const b2 = [b[0] + offset.x, b[1] + offset.y];
    pos.push(a[0], a[1], 0, b[0], b[1], 0, b2[0], b2[1], 0, a[0], a[1], 0, b2[0], b2[1], 0, a2[0], a2[1], 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function buildPlaceBuildings(places: Place[], env: LotEnv): { group: THREE.Group; buildings: PlaceBuilding[] } {
  const { proj, shadowMaterial, sunOffset } = env;
  const root = new THREE.Group();
  root.name = 'places';
  const byBuilding = new Map<string, Place[]>();
  for (const p of places) (byBuilding.get(p.osmBuildingId) ?? byBuilding.set(p.osmBuildingId, []).get(p.osmBuildingId)!).push(p);

  const buildings: PlaceBuilding[] = [];
  for (const [key, group] of byBuilding) {
    const first = group[0];
    const ring: Pt[] = first.footprint.map(([lon, lat]) => proj.toLocal(lon, lat));
    const h = Math.max(...group.map((p) => p.height));
    const fastFood = group.some((p) => p.style === 'fast-food');
    const g = new THREE.Group();
    g.name = `building:${key}`;
    g.userData.key = key;

    const brand = CATEGORIES[first.category].color;
    const wallMat = new THREE.MeshLambertMaterial({ map: fastFood ? fastFoodTexture(brand) : windowTexture(WALL_COLORS[hash(key) % WALL_COLORS.length]) });
    g.add(new THREE.Mesh(wallGeometry(ring, h, fastFood ? 1 : undefined), wallMat));

    const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
    const roofGeo = new THREE.ShapeGeometry(shape);
    roofGeo.translate(0, 0, h);
    const roofMat = new THREE.MeshBasicMaterial({ color: fastFood ? '#6b6760' : '#8a857d' });
    g.add(new THREE.Mesh(roofGeo, roofMat));
    const closed = [...ring, ring[0]].flat();
    g.add(new THREE.Mesh(buildStrips([{ p: closed, hw: 0.35 }], h + 0.03, 6), new THREE.MeshBasicMaterial({ color: '#d8d0bf' })));

    /** Glass window plus a sloped canopy (and front valance) on wall `edge` between t0 and t1. */
    const addAwning = (edge: number, t0: number, t1: number, top: number, depth: number, drop: number, tex: THREE.Texture, stripes: number) => {
      const a = ring[edge];
      const b = ring[(edge + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dir = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize();
      const n = new THREE.Vector3(dir.y, -dir.x, 0);
      const at = (t: number, out: number, z: number) =>
        new THREE.Vector3(a[0] + (b[0] - a[0]) * t + n.x * out, a[1] + (b[1] - a[1]) * t + n.y * out, z);
      const width = (t1 - t0) * len;
      const inset = Math.min(0.3, width * 0.1) / len;
      const gp: number[] = [];
      const gn: number[] = [];
      const gu: number[] = [];
      pushQuad(gp, gn, gu, [at(t0 + inset, 0.03, 0.3), at(t1 - inset, 0.03, 0.3), at(t1 - inset, 0.03, top - 0.25), at(t0 + inset, 0.03, top - 0.25)], n, UNIT);
      g.add(new THREE.Mesh(geometry(gp, gn, gu), new THREE.MeshLambertMaterial({ color: '#3a5277' })));
      const ap: number[] = [];
      const an: number[] = [];
      const au: number[] = [];
      const slopeN = new THREE.Vector3(n.x * drop, n.y * drop, depth).normalize();
      const uv = [
        [0, 0],
        [stripes, 0],
        [stripes, 1],
        [0, 1],
      ];
      pushQuad(ap, an, au, [at(t0, 0.02, top), at(t1, 0.02, top), at(t1, depth, top - drop), at(t0, depth, top - drop)], slopeN, uv);
      pushQuad(ap, an, au, [at(t0, depth, top - drop - 0.35), at(t1, depth, top - drop - 0.35), at(t1, depth, top - drop), at(t0, depth, top - drop)], n, uv);
      g.add(new THREE.Mesh(geometry(ap, an, au), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })));
      return { at, n, width };
    };

    // Storefronts: one awning, sign and window per place, spread apart if they share a wall.
    const fronts = group.map((p) => {
      const sf = proj.toLocal(p.storefront[0], p.storefront[1]);
      const edge = p.facadeEdge ?? nearestEdge(ring, sf);
      return { p, edge, span: awningSpan(ring, edge, sf) };
    });
    for (const edge of new Set(fronts.map((f) => f.edge))) separateSpans(fronts.filter((f) => f.edge === edge).map((f) => f.span));

    const storefronts: Storefront[] = [];
    for (const { p, edge, span } of fronts) {
      const top = Math.min(3.4, h - 0.9);
      const drop = fastFood ? 0.35 : 0.7;
      const depth = fastFood ? 1.2 : 1.4;
      const color = CATEGORIES[p.category].color;
      const width = (span.t1 - span.t0) * span.len;
      const { at, n } = addAwning(edge, span.t0, span.t1, top, depth, drop, awningTexture(color, fastFood), fastFood ? 1 : width / 1.2);

      // Sign board above the awning when the building is tall enough (fast food uses its pole sign).
      if (!fastFood && top + 1.6 < h - 0.2) {
        const sp: number[] = [];
        const sn: number[] = [];
        const su: number[] = [];
        const mid = (span.t0 + span.t1) / 2;
        const half = Math.min(width * 0.46, 3.4) / span.len;
        pushQuad(sp, sn, su, [at(mid - half, 0.06, top + 0.15), at(mid + half, 0.06, top + 0.15), at(mid + half, 0.06, top + 1.5), at(mid - half, 0.06, top + 1.5)], n, UNIT);
        g.add(new THREE.Mesh(geometry(sp, sn, su), new THREE.MeshLambertMaterial({ map: signTexture(p.category) })));
      }
      storefronts.push({ place: p, point: at((span.t0 + span.t1) / 2, depth / 2, top - drop / 2) });
    }

    // Lot extras: parking, drive-thru lane, pole sign, menu board, and the pickup window.
    const lots = group.map((p) => buildLot(p, env)).filter((l): l is Lot => !!l);
    for (const lot of lots) {
      for (const o of lot.ground) g.add(o);
      for (const o of lot.objects) g.add(o);
      for (const o of lot.shadows) g.add(o);
      if (lot.lane) {
        const spot = pickupSpot(lot.lane, ring);
        const len = Math.hypot(ring[(spot.edge + 1) % ring.length][0] - ring[spot.edge][0], ring[(spot.edge + 1) % ring.length][1] - ring[spot.edge][1]);
        const half = Math.min(1.4, len / 2 - 0.3) / len;
        const t = Math.min(1 - half, Math.max(half, spot.t));
        addAwning(spot.edge, t - half, t + half, Math.min(3.0, h - 1.2), 1.0, 0.2, awningTexture(brand, true), 1);
      }
    }
    // Shadow and the Sims-style selection outline on the ground.
    const shadow = new THREE.Mesh(shadowGeometry(ring, sunOffset.clone().multiplyScalar(h)), shadowMaterial);
    shadow.userData.noPick = true;
    g.add(shadow);
    const outline = new THREE.Mesh(
      buildStrips([{ p: closed, hw: 1.1 }], 0.12, 8),
      new THREE.MeshBasicMaterial({ color: '#ffe45c', depthWrite: false }),
    );
    outline.renderOrder = 5;
    outline.visible = false;
    outline.userData.noPick = true;
    g.add(outline);

    const building: PlaceBuilding = {
      key,
      places: group,
      ring,
      height: h,
      centroid: ringCentroid(ring),
      group: g,
      storefronts,
      blocksTree: lots.length ? (x, y) => lots.some((l) => l.blocksTree(x, y)) : undefined,
      setHighlight(on) {
        outline.visible = on;
        wallMat.emissive.set(on ? '#2a2a14' : '#000000');
      },
    };
    buildings.push(building);
    root.add(g);
  }
  return { group: root, buildings };
}

/** True when a point is inside or within `margin` meters of any building (used to clear trees). */
export function nearAnyBuilding(buildings: PlaceBuilding[], margin: number): (x: number, y: number) => boolean {
  const boxes = buildings.map((b) => {
    const xs = b.ring.map((p) => p[0]);
    const ys = b.ring.map((p) => p[1]);
    return { b, minX: Math.min(...xs) - margin, maxX: Math.max(...xs) + margin, minY: Math.min(...ys) - margin, maxY: Math.max(...ys) + margin };
  });
  return (x, y) =>
    boxes.some(
      ({ b, minX, maxX, minY, maxY }) =>
        (x >= minX && x <= maxX && y >= minY && y <= maxY && (pointInRing(x, y, b.ring) || distToRing(x, y, b.ring) < margin)) || !!b.blocksTree?.(x, y),
    );
}
