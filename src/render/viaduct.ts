import * as THREE from 'three';
import { rng, type Pt } from '../geo.ts';
import type { MapData } from '../mapdata.ts';
import { buildStrips } from './strips.ts';

export const VIADUCT_DECK_TOP = 8.6;
const DECK_TOP = VIADUCT_DECK_TOP;
const DECK_BOTTOM = 7.4;
const HALF_WIDTH = 2.7;
const PILLAR_SPACING = 20;

// Arched concrete viaduct over Queens Blvd (33rd-48th St).
const PIER_SPACING = 15;
const PIER_LEN = 2.2;
const SPRING = 3.6; // where each arch starts to curve
const CROWN = 6.5; // top of each arch opening
const PARAPET_TOP = DECK_TOP + 0.65;
const STONE_U = 2.4; // meters per texture repeat along the wall
const STONE_V = 1.2; // meters per texture repeat up the wall

/** Light stone blocks in running bond. */
function stoneTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c2b79f';
  ctx.fillRect(0, 0, 128, 64);
  const rand = rng(11);
  for (let row = 0; row < 2; row++)
    for (let col = -1; col < 4; col++) {
      const x = col * 32 + (row % 2 ? 16 : 0);
      const tint = 0.94 + rand() * 0.1;
      ctx.fillStyle = `rgb(${Math.round(232 * tint)}, ${Math.round(224 * tint)}, ${Math.round(206 * tint)})`;
      ctx.fillRect(x + 1, row * 32 + 1, 30, 30);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Collects triangles with normals and wall-texture UVs (in meters / repeat size). */
class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3, ua: number[], ub: number[], uc: number[]) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) this.nrm.push(n.x, n.y, n.z);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  /** Quad a-b-c-d with UVs from its own width (a->b) and heights. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, u0 = 0) {
    const w = a.distanceTo(b);
    const uva = [u0 / STONE_U, a.z / STONE_V];
    const uvb = [(u0 + w) / STONE_U, b.z / STONE_V];
    const uvc = [(u0 + w) / STONE_U, c.z / STONE_V];
    const uvd = [u0 / STONE_U, d.z / STONE_V];
    this.tri(a, b, c, n, uva, uvb, uvc);
    this.tri(a, c, d, n, uva, uvc, uvd);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

const toPts = (f: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
  return out;
};

/** Position, unit tangent and left normal at arc length s along a polyline. */
function frameAt(line: Pt[], cum: number[], s: number) {
  let i = 1;
  while (i < line.length - 1 && cum[i] < s) i++;
  const [ax, ay] = line[i - 1];
  const [bx, by] = line[i];
  const len = cum[i] - cum[i - 1] || 1;
  const k = Math.min(1, Math.max(0, (s - cum[i - 1]) / len));
  const t = new THREE.Vector3((bx - ax) / len, (by - ay) / len, 0);
  return { p: new THREE.Vector3(ax + (bx - ax) * k, ay + (by - ay) * k, 0), t, n: new THREE.Vector3(-t.y, t.x, 0), s };
}

/**
 * Stone-looking arched viaduct: full-width piers, arched walls between them on both sides, a
 * cornice band and parapets, carrying all tracks on one deck.
 */
function buildAqueduct(a: MapData['aqueduct'][number], stone: THREE.Material, trim: THREE.Material): THREE.Mesh[] {
  const line = toPts(a.p);
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const L = cum[cum.length - 1];
  const walls = new Builder();
  const cornice = new Builder();
  const up = (v: THREE.Vector3, z: number) => v.clone().setZ(z);

  // Piers, evenly spaced, including one at each end as an abutment.
  const n = Math.max(1, Math.round((L - PIER_LEN) / PIER_SPACING));
  const step = (L - PIER_LEN) / n;
  const piers = Array.from({ length: n + 1 }, (_, k) => frameAt(line, cum, PIER_LEN / 2 + k * step));
  for (const f of piers) {
    const c = (along: number, across: number) => f.p.clone().addScaledVector(f.t, along).addScaledVector(f.n, across);
    const bl = c(-PIER_LEN / 2, -a.wr);
    const br = c(PIER_LEN / 2, -a.wr);
    const fl = c(-PIER_LEN / 2, a.wl);
    const fr = c(PIER_LEN / 2, a.wl);
    // Four sides, each wound to face outward.
    walls.quad(up(br, 0), up(fr, 0), up(fr, DECK_BOTTOM), up(br, DECK_BOTTOM), f.t, f.s);
    walls.quad(up(fl, 0), up(bl, 0), up(bl, DECK_BOTTOM), up(fl, DECK_BOTTOM), f.t.clone().negate(), f.s);
    walls.quad(up(fr, 0), up(fl, 0), up(fl, DECK_BOTTOM), up(fr, DECK_BOTTOM), f.n, f.s);
    walls.quad(up(bl, 0), up(br, 0), up(br, DECK_BOTTOM), up(bl, DECK_BOTTOM), f.n.clone().negate(), f.s);
  }

  // Arched walls between piers on both faces: the wall above a segmental arch, below the deck.
  for (let k = 0; k + 1 < piers.length; k++) {
    const f0 = piers[k];
    const f1 = piers[k + 1];
    for (const side of [1, -1]) {
      const off = side > 0 ? a.wl : -a.wr;
      const A = f0.p.clone().addScaledVector(f0.t, PIER_LEN / 2).addScaledVector(f0.n, off);
      const B = f1.p.clone().addScaledVector(f1.t, -PIER_LEN / 2).addScaledVector(f1.n, off);
      const span = A.distanceTo(B);
      if (span < 2) continue;
      const dir = B.clone().sub(A).normalize();
      const normal = f0.n.clone().multiplyScalar(side);
      const rise = CROWN - SPRING;
      const R = ((span / 2) ** 2 + rise ** 2) / (2 * rise);
      const outline: THREE.Vector2[] = [new THREE.Vector2(0, SPRING), new THREE.Vector2(0, DECK_BOTTOM), new THREE.Vector2(span, DECK_BOTTOM), new THREE.Vector2(span, SPRING)];
      for (let i = 1; i < 16; i++) {
        const u = span * (1 - i / 16);
        outline.push(new THREE.Vector2(u, CROWN - R + Math.sqrt(Math.max(0, R * R - (u - span / 2) ** 2))));
      }
      const world = (p: THREE.Vector2) => A.clone().addScaledVector(dir, p.x).setZ(p.y);
      const uvOf = (p: THREE.Vector2) => [(f0.s + PIER_LEN / 2 + p.x) / STONE_U, p.y / STONE_V];
      for (const [i, j, l] of THREE.ShapeUtils.triangulateShape(outline, [])) {
        walls.tri(world(outline[i]), world(outline[j]), world(outline[l]), normal, uvOf(outline[i]), uvOf(outline[j]), uvOf(outline[l]));
      }
    }
  }

  // Cornice band and parapet along both outer edges, following the centerline.
  for (let i = 1; i < line.length; i++) {
    const f0 = frameAt(line, cum, cum[i - 1] + 1e-6);
    const p0 = new THREE.Vector3(line[i - 1][0], line[i - 1][1], 0);
    const p1 = new THREE.Vector3(line[i][0], line[i][1], 0);
    for (const side of [1, -1]) {
      const off = side > 0 ? a.wl : -a.wr;
      const nn = f0.n.clone().multiplyScalar(side);
      const at = (p: THREE.Vector3, extra: number, z: number) => p.clone().addScaledVector(f0.n, off + side * extra).setZ(z);
      // Outer face, slightly proud of the arched wall.
      cornice.quad(at(p0, 0.15, DECK_BOTTOM), at(p1, 0.15, DECK_BOTTOM), at(p1, 0.15, PARAPET_TOP), at(p0, 0.15, PARAPET_TOP), nn, cum[i - 1]);
      // Inner face of the parapet and its top.
      cornice.quad(at(p1, -0.25, DECK_TOP), at(p0, -0.25, DECK_TOP), at(p0, -0.25, PARAPET_TOP), at(p1, -0.25, PARAPET_TOP), nn.clone().negate(), cum[i - 1]);
      cornice.quad(at(p0, 0.15, PARAPET_TOP), at(p1, 0.15, PARAPET_TOP), at(p1, -0.25, PARAPET_TOP), at(p0, -0.25, PARAPET_TOP), new THREE.Vector3(0, 0, 1), cum[i - 1]);
    }
  }

  const deck = new THREE.Mesh(
    buildStrips([{ p: a.p, hw: Math.max(a.wl, a.wr) - 0.1 }], DECK_TOP - 0.02, 8),
    new THREE.MeshBasicMaterial({ color: '#5d554c' }),
  );
  return [new THREE.Mesh(walls.geometry(), stone), new THREE.Mesh(cornice.geometry(), trim), deck];
}

/** Steel girders and pillars for the parts of the line that are not the concrete viaduct. */
function buildSteel(lines: number[][], steel: THREE.Material): THREE.Object3D[] {
  const pos: number[] = [];
  const nrm: number[] = [];
  const pillars: THREE.Vector2[] = [];
  for (const p of lines) {
    let carry = PILLAR_SPACING / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i];
      const ay = p[i + 1];
      const bx = p[i + 2];
      const by = p[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      for (const side of [1, -1]) {
        const ox = nx * HALF_WIDTH * side;
        const oy = ny * HALF_WIDTH * side;
        const quad = [
          [ax + ox, ay + oy, DECK_BOTTOM],
          [bx + ox, by + oy, DECK_BOTTOM],
          [bx + ox, by + oy, DECK_TOP],
          [ax + ox, ay + oy, DECK_BOTTOM],
          [bx + ox, by + oy, DECK_TOP],
          [ax + ox, ay + oy, DECK_TOP],
        ];
        for (const v of quad) {
          pos.push(...v);
          nrm.push(nx * side, ny * side, 0);
        }
      }
      let d = carry;
      while (d < len) {
        pillars.push(new THREE.Vector2(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len));
        d += PILLAR_SPACING;
      }
      carry = d - len;
    }
  }
  const girderGeo = new THREE.BufferGeometry();
  girderGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  girderGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const pillarGeo = new THREE.BoxGeometry(0.9, 0.9, DECK_BOTTOM);
  pillarGeo.translate(0, 0, DECK_BOTTOM / 2);
  const pillarMesh = new THREE.InstancedMesh(pillarGeo, steel, pillars.length);
  const m = new THREE.Matrix4();
  pillars.forEach((pt, i) => pillarMesh.setMatrixAt(i, m.makeTranslation(pt.x, pt.y, 0)));
  return [new THREE.Mesh(girderGeo, steel), pillarMesh];
}

/**
 * The 7 train's elevated structure: an arched stone-look viaduct over Queens Blvd (33rd-48th St),
 * steel girders and pillars elsewhere, and the track deck and rails on top throughout.
 */
export function buildViaduct(data: Pick<MapData, 'viaduct' | 'viaductParts' | 'aqueduct'>, shadowMaterial: THREE.Material, sunOffset: THREE.Vector2): THREE.Group {
  const group = new THREE.Group();
  group.name = 'viaduct';
  const lines = data.viaduct;
  const objects: THREE.Object3D[] = [
    new THREE.Mesh(buildStrips(lines.map((p) => ({ p, hw: HALF_WIDTH })), DECK_TOP), new THREE.MeshBasicMaterial({ color: '#4f4a45' })),
    new THREE.Mesh(buildStrips(lines.map((p) => ({ p, hw: 0.82 })), DECK_TOP + 0.03), new THREE.MeshBasicMaterial({ color: '#9c9ca0' })),
    new THREE.Mesh(buildStrips(lines.map((p) => ({ p, hw: 0.68 })), DECK_TOP + 0.06), new THREE.MeshBasicMaterial({ color: '#3b342e' })),
  ];

  const steelParts = data.viaductParts.filter((v) => v.k === 'steel').map((v) => v.p);
  objects.push(...buildSteel(steelParts, new THREE.MeshLambertMaterial({ color: '#6f8d77', side: THREE.DoubleSide })));

  // A little self-light keeps the shaded side reading as pale stone rather than mud.
  const stone = new THREE.MeshLambertMaterial({ map: stoneTexture(), side: THREE.DoubleSide, emissive: '#3a342a' });
  const trim = new THREE.MeshLambertMaterial({ color: '#ddd4c0', side: THREE.DoubleSide, emissive: '#2f2a22' });
  for (const a of data.aqueduct) objects.push(...buildAqueduct(a, stone, trim));

  // Ground shadows: the deck outlines shifted away from the sun.
  const shift = (p: number[]) => p.map((v, i) => v + (i % 2 === 0 ? sunOffset.x : sunOffset.y) * DECK_TOP);
  const shadowLines = [
    ...steelParts.map((p) => ({ p: shift(p), hw: HALF_WIDTH })),
    ...data.aqueduct.map((a) => ({ p: shift(a.p), hw: Math.max(a.wl, a.wr) })),
  ];
  objects.push(new THREE.Mesh(buildStrips(shadowLines), shadowMaterial));

  for (const obj of objects) {
    obj.frustumCulled = false;
    group.add(obj);
  }
  return group;
}
