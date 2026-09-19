import * as THREE from 'three';
import { distToSegment, pointInRing, projectOnSegment, type Projection, type Pt } from '../geo.ts';
import { placeColor, type Place } from '../places.ts';
import { COLORS } from './ground.ts';
import { canvasTexture, fitFont, panelEdge, twoSidedPanel } from './panel.ts';
import { groundMaterial, type FadeUniforms } from './shaders.ts';
import { buildStrips } from './strips.ts';

export interface LotEnv {
  proj: Projection;
  fade: FadeUniforms;
  /** Ground draw slot for lots: after land use, before roads. */
  lotOrder: number;
  shadowMaterial: THREE.Material;
  sunOffset: THREE.Vector2;
  /** Named ground-level roads, to face the pole sign along the street. */
  roads: Array<{ n?: string; w: number; p: number[] }>;
}

export interface Lot {
  /** Flat ground pieces (drawn in the ground pass). */
  ground: THREE.Object3D[];
  /** Upright, pickable pieces (sign, menu board). */
  objects: THREE.Object3D[];
  /** Shadows on the ground. */
  shadows: THREE.Object3D[];
  /** Trees here would stand in the parking lot or the lane. */
  blocksTree(x: number, y: number): boolean;
  /** Point on the drive-thru lane closest to the building (for the pickup window), if any. */
  lane?: Pt[];
}

const POLE_TOP = 9.6;
const SIGN_H = 2.6;
const SIGN_W = 5.4;

function flatShape(ring: Pt[]): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y))));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

function ground(geo: THREE.BufferGeometry, mat: THREE.Material, order: number) {
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = order;
  m.frustumCulled = false;
  m.userData.noPick = true;
  return m;
}

function poleSignTexture(place: Place, driveThru: boolean) {
  const color = placeColor(place);
  return canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#f6f2e6';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(10, 10, 492, driveThru ? 170 : 236, 22);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = place.name.toUpperCase();
    const size = fitFont(ctx, name, 450, 110);
    ctx.lineWidth = Math.max(4, size / 12);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeText(name, 256, driveThru ? 98 : 131);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, 256, driveThru ? 95 : 128);
    if (driveThru) {
      ctx.fillStyle = color;
      fitFont(ctx, 'DRIVE-THRU', 400, 52, 900);
      ctx.fillText('DRIVE-THRU', 256, 218);
    }
  });
}

function menuTexture(place: Place) {
  const color = placeColor(place);
  return canvasTexture(128, 96, (ctx) => {
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 128, 22);
    ctx.fillStyle = '#f3e9c8';
    for (let r = 0; r < 6; r++) {
      ctx.fillRect(10, 30 + r * 10, 60 + ((r * 17) % 30), 4);
      ctx.fillRect(100, 30 + r * 10, 18, 4);
    }
  });
}

/** Parking lot, drive-thru lane, pole sign and menu board for a place that has a `lot`. */
export function buildLot(place: Place, env: LotEnv): Lot | null {
  const lot = place.lot;
  if (!lot) return null;
  const toLocal = (ring: Array<[number, number]>): Pt[] => ring.map(([lon, lat]) => env.proj.toLocal(lon, lat));
  const paved = (lot.paved ?? []).map(toLocal);
  const walks = (lot.walks ?? []).map(toLocal);
  const lane = lot.driveThru ? toLocal(lot.driveThru) : undefined;
  const out: Lot = { ground: [], objects: [], shadows: [], blocksTree: () => false, lane };
  const o = env.lotOrder;

  if (paved.length) out.ground.push(ground(mergeAll(paved.map(flatShape)), groundMaterial('#6f7075', 'grain', env.fade), o));
  if (lane) {
    const p = lane.flat();
    out.ground.push(ground(buildStrips([{ p, hw: 1.9 }], 0, 8), groundMaterial('#54555a', 'grain', env.fade), o + 0.2));
    // Dashed centerline so it reads as a lane.
    const dashes: number[] = [];
    walkLine(lane, 3, (x, y, dx, dy, i) => {
      if (i % 2) return;
      dashes.push(x, y, x + dx * 1.4, y + dy * 1.4);
    });
    const dashLines = [];
    for (let i = 0; i < dashes.length; i += 4) dashLines.push({ p: dashes.slice(i, i + 4), hw: 0.09 });
    out.ground.push(ground(buildStrips(dashLines, 0, 4), groundMaterial('#f1eee2', 'plain', env.fade), o + 0.3));
  }
  if (walks.length) out.ground.push(ground(mergeAll(walks.map(flatShape)), groundMaterial(COLORS.sidewalk, 'grain', env.fade), o + 0.4));

  // Tall pole sign, facing along the nearest street so drivers from both directions see it.
  let sign: Pt | null = null;
  if (lot.poleSign) {
    sign = env.proj.toLocal(...lot.poleSign);
    const along = roadDirection(env.roads, sign) ?? new THREE.Vector3(1, 0, 0);
    const steel = new THREE.MeshLambertMaterial({ color: '#70757c' });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, POLE_TOP - SIGN_H / 2, 12), steel);
    pole.rotation.x = Math.PI / 2;
    pole.position.set(sign[0], sign[1], (POLE_TOP - SIGN_H / 2) / 2);
    const center = new THREE.Vector3(sign[0], sign[1], POLE_TOP - SIGN_H / 2);
    const faceMat = new THREE.MeshLambertMaterial({ map: poleSignTexture(place, !!lane), emissive: '#1d1d1d' });
    out.objects.push(
      pole,
      twoSidedPanel(center, along, SIGN_W, SIGN_H, 0.5, faceMat),
      panelEdge(center, along, SIGN_W, SIGN_H, 0.5, new THREE.MeshLambertMaterial({ color: '#f6f2e6' })),
    );
    // Shadow of the pole and the board.
    const tip = new THREE.Vector2(sign[0], sign[1]).addScaledVector(env.sunOffset, POLE_TOP - SIGN_H);
    const boardMid = new THREE.Vector2(sign[0], sign[1]).addScaledVector(env.sunOffset, POLE_TOP - SIGN_H / 2);
    const t = new THREE.Vector2(-along.y, along.x); // board runs perpendicular to its normal
    out.shadows.push(
      new THREE.Mesh(buildStrips([{ p: [sign[0], sign[1], tip.x, tip.y], hw: 0.3 }], 0, 6), env.shadowMaterial),
      new THREE.Mesh(
        buildStrips(
          [{ p: [boardMid.x - (t.x * SIGN_W) / 2, boardMid.y - (t.y * SIGN_W) / 2, boardMid.x + (t.x * SIGN_W) / 2, boardMid.y + (t.y * SIGN_W) / 2], hw: 0.9 }],
          0,
          6,
        ),
        env.shadowMaterial,
      ),
    );
  }

  // Menu board beside the lane, on the driver's (left) side, early on (you order before the window).
  if (lane) {
    const at = pointAlong(lane, 0.22);
    if (at) {
      const left = new THREE.Vector3(-at.dy, at.dx, 0);
      const base = new THREE.Vector3(at.x, at.y, 0).addScaledVector(left, 2.6);
      const center = base.clone().setZ(1.5);
      const mat = new THREE.MeshLambertMaterial({ map: menuTexture(place) });
      out.objects.push(twoSidedPanel(center, left.clone().negate(), 2.0, 1.5, 0.2, mat));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.8), new THREE.MeshLambertMaterial({ color: '#3a3d42' }));
      post.position.copy(base).setZ(0.4);
      out.objects.push(post);
    }
  }

  out.blocksTree = (x, y) =>
    paved.some((r) => pointInRing(x, y, r)) ||
    walks.some((r) => pointInRing(x, y, r)) ||
    (!!lane && lane.some((p, i) => i > 0 && distToSegment(x, y, lane[i - 1][0], lane[i - 1][1], p[0], p[1]) < 3)) ||
    (!!sign && Math.hypot(x - sign[0], y - sign[1]) < 3.5);
  for (const obj of [...out.objects, ...out.shadows]) obj.frustumCulled = false;
  for (const s of out.shadows) s.userData.noPick = true;
  return out;
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 1) return geos[0];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const g of geos) {
    const base = pos.length / 3;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setIndex(idx);
  return m;
}

/** Calls f every `step` meters along a polyline with the unit direction there. */
function walkLine(line: Pt[], step: number, f: (x: number, y: number, dx: number, dy: number, i: number) => void) {
  let carry = 0;
  let i = 0;
  for (let s = 1; s < line.length; s++) {
    const [ax, ay] = line[s - 1];
    const [bx, by] = line[s];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len;
    const dy = (by - ay) / len;
    let d = carry;
    for (; d < len; d += step) f(ax + dx * d, ay + dy * d, dx, dy, i++);
    carry = d - len;
  }
}

/** Point and direction at a fraction of a polyline's length. */
export function pointAlong(line: Pt[], frac: number): { x: number; y: number; dx: number; dy: number } | null {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  let want = total * frac;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (want <= len && len > 0) return { x: ax + ((bx - ax) * want) / len, y: ay + ((by - ay) * want) / len, dx: (bx - ax) / len, dy: (by - ay) / len };
    want -= len;
  }
  return null;
}

/** Direction of the nearest named road at a point (unit vector), or null if none within 60 m. */
function roadDirection(roads: LotEnv['roads'], p: Pt): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestD = 60;
  for (const r of roads) {
    if (!r.n) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const d = distToSegment(p[0], p[1], r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]);
      if (d < bestD) {
        bestD = d;
        best = new THREE.Vector3(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1], 0).normalize();
      }
    }
  }
  return best;
}

/** Wall index and position (0-1) nearest to a point, for placing the pickup window. */
export function nearestWallSpot(ring: Pt[], p: Pt): { edge: number; t: number; dist: number } {
  let best = { edge: 0, t: 0.5, dist: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const d = distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]);
    if (d < best.dist) best = { edge: i, t: projectOnSegment(p[0], p[1], a[0], a[1], b[0], b[1]), dist: d };
  }
  return best;
}

/** Where the pickup window goes: the wall spot the lane passes closest to in its middle stretch. */
export function pickupSpot(lane: Pt[], ring: Pt[]): { edge: number; t: number; dist: number } {
  let best = { edge: 0, t: 0.5, dist: Infinity };
  for (let f = 0.35; f <= 0.85; f += 0.01) {
    const at = pointAlong(lane, f);
    if (!at) continue;
    const spot = nearestWallSpot(ring, [at.x, at.y]);
    if (spot.dist < best.dist) best = spot;
  }
  return best;
}
