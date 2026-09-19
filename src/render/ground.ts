import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARK_LOOKS } from '../data/parkLooks.ts';
import type { AreaKind, MapData } from '../mapdata.ts';
import { courtGeometry, courtTexture, findCourts, type Court } from './courts.ts';
import { groundMaterial, grassMaterial, type FadeUniforms, type GroundPattern } from './shaders.ts';
import { buildStrips, type StripLine } from './strips.ts';

/** Soft mask: 1 inside the Sunnyside boundary, falling to 0 about 100 m outside it. */
export function buildFadeUniforms(data: MapData): FadeUniforms {
  const { minX, minY, maxX, maxY } = data.bounds;
  const w = maxX - minX;
  const h = maxY - minY;
  const W = 1024;
  const H = Math.round((W * h) / w);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const poly of data.boundary)
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 2) {
        const px = ((ring[i] - minX) / w) * W;
        const py = ((maxY - ring[i + 1]) / h) * H;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  ctx.fill('evenodd');
  const img = ctx.getImageData(0, 0, W, H);
  boxBlur(img, W, H, 14, 3);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { uMask: { value: tex }, uBounds: { value: new THREE.Vector4(minX, minY, 1 / w, 1 / h) } };
}

/** In-place separable box blur on the red channel (copied to g/b), repeated `passes` times. */
function boxBlur(img: ImageData, W: number, H: number, r: number, passes: number) {
  const a = new Float32Array(W * H);
  const b = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = img.data[i * 4];
  const norm = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[y * W + x] = s * norm;
        s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = s * norm;
        s += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const v = Math.round(a[i]);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
}

const AREA_STYLE: Record<AreaKind, [THREE.ColorRepresentation, GroundPattern]> = {
  grass: ['#5f8a34', 'grain'],
  park: ['#679a38', 'grain'],
  wood: ['#3f6a2a', 'grain'],
  cemetery: ['#000000', 'cemetery'],
  rail: ['#8b8274', 'gravel'],
  water: ['#3f4f86', 'water'],
  pitch: ['#79a843', 'pitch'],
  playground: ['#c2a778', 'grain'],
  dogrun: ['#9e8a68', 'gravel'],
};
const AREA_ORDER: AreaKind[] = ['grass', 'park', 'wood', 'cemetery', 'rail', 'water', 'dogrun', 'pitch', 'playground'];

export const COLORS = {
  sidewalk: '#bcb6a5',
  asphalt: '#5e5f63',
  line: '#dedcd2',
  railBed: '#5a4c40',
  railSteel: '#a4a4a8',
  ballast: '#8b8274',
  thirdRail: '#a89877',
};

/** A court's polygon, painted with its own texture (inside the boundary, so no forest fade). */
function courtMesh(c: Court, order: number): THREE.Mesh {
  const m = new THREE.Mesh(courtGeometry(c), new THREE.MeshBasicMaterial({ map: courtTexture(c), depthTest: false, depthWrite: false }));
  m.renderOrder = order;
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  return m;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, order: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = order;
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  return m;
}

export function buildGround(data: MapData, fade: FadeUniforms): { group: THREE.Group; lotOrder: number } {
  const group = new THREE.Group();
  group.name = 'ground';
  let order = -1000;

  // Grass everywhere; it turns into forest outside the boundary.
  const { minX, minY, maxX, maxY } = data.bounds;
  const pad = 4000;
  const plane = new THREE.PlaneGeometry(maxX - minX + 2 * pad, maxY - minY + 2 * pad);
  plane.translate((minX + maxX) / 2, (minY + maxY) / 2, 0);
  group.add(mesh(plane, grassMaterial(fade), order++));

  // Land use, painted in a fixed order. Courts and the parks we modeled get their own paint below.
  const courts = findCourts(data);
  const painted = new Set(courts.map((c) => c.id));
  for (const kind of AREA_ORDER) {
    const geos: THREE.BufferGeometry[] = [];
    const extra: Array<[THREE.BufferGeometry, string]> = [];
    for (const a of data.areas) {
      if (a.k !== kind || (a.id && painted.has(a.id))) continue;
      const toV = (r: number[]) => {
        const v: THREE.Vector2[] = [];
        for (let i = 0; i < r.length; i += 2) v.push(new THREE.Vector2(r[i], r[i + 1]));
        return v;
      };
      const shape = new THREE.Shape(toV(a.r[0]));
      for (const hole of a.r.slice(1)) shape.holes.push(new THREE.Path(toV(hole)));
      const g = new THREE.ShapeGeometry(shape);
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      const look = a.id ? PARK_LOOKS[a.id] : undefined;
      if (look) extra.push([g, look.ground]);
      else geos.push(g);
    }
    const [color, pattern] = AREA_STYLE[kind];
    if (geos.length) {
      group.add(mesh(mergeGeometries(geos)!, groundMaterial(color, pattern, fade), order++));
      geos.forEach((g) => g.dispose());
    }
    // Paved playgrounds: asphalt or concrete instead of grass.
    for (const [g, c] of extra) group.add(mesh(g, groundMaterial(c, 'grain', fade), order++));
  }

  // Painted courts, each with its own markings.
  for (const c of courts) group.add(courtMesh(c, order++));

  // Draw slot for place lots (parking, drive-thru lanes): above land use, below rails and roads.
  const lotOrder = order++;

  // Ground-level railway tracks: ballast, sleepers, then two steel rails left by an inner bed strip,
  // plus the LIRR's third rail under its cover board.
  const railBed = groundMaterial(COLORS.railBed, 'grain', fade);
  const railSteel = groundMaterial(COLORS.railSteel, 'plain', fade);
  group.add(mesh(buildStrips(data.rails.map((p) => ({ p, hw: 2.4 }))), groundMaterial(COLORS.ballast, 'gravel', fade), order++));
  group.add(mesh(buildStrips(data.thirdRails.map((p) => ({ p, hw: 0.28 }))), groundMaterial(COLORS.thirdRail, 'grain', fade), order++));
  group.add(mesh(buildStrips(data.rails.map((p) => ({ p, hw: 1.4 }))), railBed, order++));
  group.add(mesh(buildStrips(data.rails.map((p) => ({ p, hw: 0.82 }))), railSteel, order++));
  group.add(mesh(buildStrips(data.rails.map((p) => ({ p, hw: 0.68 }))), railBed, order++));

  // Roads, one stack of layers per bridge level so bridges pass cleanly over what is below.
  const sidewalk = groundMaterial(COLORS.sidewalk, 'grain', fade);
  const asphalt = groundMaterial(COLORS.asphalt, 'grain', fade);
  const line = groundMaterial(COLORS.line, 'plain', fade);
  const levels = [...new Set(data.roads.map((r) => r.l))].sort((a, b) => a - b);
  for (const level of levels) {
    const rs = data.roads.filter((r) => r.l === level);
    const minEdge = level > 0 ? 0.5 : 0;
    const layers: Array<[StripLine[], THREE.Material]> = [
      [rs.filter((r) => r.sw > 0 || minEdge > 0).map((r) => ({ p: r.p, hw: r.w / 2 + Math.max(r.sw, minEdge) })), sidewalk],
      [rs.filter((r) => r.w > 0).map((r) => ({ p: r.p, hw: r.w / 2 })), asphalt],
      [rs.filter((r) => r.ln).map((r) => ({ p: r.p, hw: r.w / 2 - 0.55 })), line],
      [rs.filter((r) => r.ln).map((r) => ({ p: r.p, hw: r.w / 2 - 0.85 })), asphalt],
    ];
    for (const [lines, mat] of layers) if (lines.length) group.add(mesh(buildStrips(lines), mat, order++));
  }
  return { group, lotOrder };
}
