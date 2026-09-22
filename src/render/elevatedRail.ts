import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pt } from '../geo.ts';
import type { MapData } from '../mapdata.ts';
import { COLORS } from './ground.ts';
import { buildStrips } from './strips.ts';

// The LIRR Main Line, the Port Washington Branch and Amtrak's Northeast Corridor leave Sunnyside
// Yard on an embankment and stay up all the way across Woodside, on plate-girder spans where they
// cross a street and on a ballasted bank in between, with a ramp at each end back down to the yard.
export const ELEVATED_RAIL_TOP = 6.4; // top of the ballast, about 5 m of clearance under the girders
const DECK_TOP = ELEVATED_RAIL_TOP;
const GIRDER_DEPTH = 1.3;
const DECK_HW = 3.2; // half width of one track's deck
const BALLAST_HW = 2.6;
const BATTER = 0.55; // how far an embankment slope spreads per meter of height
const ABUTMENT_LEN = 2.6;

const toPts = (f: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
  return out;
};

/** Unit left normal at vertex i of a polyline (averaged across a bend). */
function normalAt(line: Pt[], i: number): Pt {
  const a = line[Math.max(0, i - 1)];
  const b = line[Math.min(line.length - 1, i + 1)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
}

/** Arc length at each vertex, and the total. */
function arcLengths(line: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  return cum;
}

/** Collects triangles with flat normals. */
class Mesh3 {
  pos: number[] = [];
  nrm: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], n: number[]) {
    for (const v of [a, b, c, a, c, d]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nrm.push(n[0], n[1], n[2]);
    }
  }
  get geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    return g;
  }
}

/** A ribbon following `line` at height z(i) and half width hw(i), as one quad per segment. */
function ribbon(line: Pt[], z: (i: number) => number, hw: (i: number) => number): number[][][] {
  const quads: number[][][] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const n0 = normalAt(line, i);
    const n1 = normalAt(line, i + 1);
    const [w0, w1] = [hw(i), hw(i + 1)];
    const [z0, z1] = [z(i), z(i + 1)];
    quads.push([
      [line[i][0] + n0[0] * w0, line[i][1] + n0[1] * w0, z0],
      [line[i + 1][0] + n1[0] * w1, line[i + 1][1] + n1[1] * w1, z1],
      [line[i + 1][0] - n1[0] * w1, line[i + 1][1] - n1[1] * w1, z1],
      [line[i][0] - n0[0] * w0, line[i][1] - n0[1] * w0, z0],
    ]);
  }
  return quads;
}

/** Flat top surface of a ribbon (ballast, rails), as a geometry drawn from above. */
function ribbonSurface(line: Pt[], z: (i: number) => number, hw: number, lift: number, offset = 0): THREE.BufferGeometry {
  const m = new Mesh3();
  const shifted = offset ? line.map((p, i) => [p[0] + normalAt(line, i)[0] * offset, p[1] + normalAt(line, i)[1] * offset] as Pt) : line;
  // Wound clockwise seen from below, so the upward face is the front face.
  for (const q of ribbon(shifted, (i) => z(i) + lift, () => hw)) m.quad(q[3], q[2], q[1], q[0], [0, 0, 1]);
  return m.geometry;
}

/** Surface kinds stacked on a track: ballast, the two steel rails, the bed between them, and the
 *  third rail beside them on the electrified lines. */
type Surface = { g: THREE.BufferGeometry; c: string };
const trackSurfaces = (line: Pt[], z: (i: number) => number, electrified: boolean, ballastHw: number): Surface[] => [
  { g: ribbonSurface(line, z, ballastHw, 0.01), c: COLORS.ballast },
  ...(electrified ? [{ g: ribbonSurface(line, z, 0.28, 0.12, 1.45), c: COLORS.thirdRail }] : []),
  { g: ribbonSurface(line, z, 0.82, 0.06), c: COLORS.railSteel },
  { g: ribbonSurface(line, z, 0.68, 0.09), c: COLORS.railBed },
];

/**
 * One elevated run: a ballasted bank with girder spans over the streets, concrete abutments at the
 * ends of each span, and a ramp at each end of the run sloping back down to the yard.
 */
function buildOne(b: NonNullable<MapData['elevatedRail']>[number], steel: Mesh3, concrete: Mesh3, bank: Mesh3, tops: Surface[], shadows: number[][]) {
  const line = toPts(b.p);
  if (line.length < 2) return;
  const level = () => DECK_TOP;

  // Earth slopes down to the ground on both sides of the bank, between the girder spans.
  const spans = b.s.map(toPts);
  for (const piece of b.k.map(toPts)) if (piece.length >= 2) bankSides(piece, level, bank);
  tops.push(...trackSurfaces(line, level, b.e === 1, BALLAST_HW + 0.4));
  shadows.push(b.p);

  for (const span of spans) {
    if (span.length < 2) continue;
    // Plate girders down both sides of the span, carrying the deck over the street.
    for (const q of ribbon(span, level, () => DECK_HW)) {
      for (const [outer, inner, dir] of [
        [q[0], q[1], -1],
        [q[3], q[2], 1],
      ] as Array<[number[], number[], number]>) {
        const len = Math.hypot(inner[0] - outer[0], inner[1] - outer[1]) || 1;
        const n = [((inner[1] - outer[1]) / len) * dir, (-(inner[0] - outer[0]) / len) * dir, 0];
        steel.quad(
          [outer[0], outer[1], DECK_TOP - GIRDER_DEPTH],
          [inner[0], inner[1], DECK_TOP - GIRDER_DEPTH],
          [inner[0], inner[1], DECK_TOP],
          [outer[0], outer[1], DECK_TOP],
          n,
        );
      }
    }
    // Concrete abutment where each end of the span meets the bank.
    for (const [end, prev] of [
      [span[0], span[1]],
      [span[span.length - 1], span[span.length - 2]],
    ]) {
      const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
      const t: Pt = [(end[0] - prev[0]) / len, (end[1] - prev[1]) / len];
      const n: Pt = [-t[1], t[0]];
      const w = DECK_HW + 0.3;
      const corner = (along: number, across: number, z: number) => [end[0] + t[0] * along + n[0] * across, end[1] + t[1] * along + n[1] * across, z];
      const faces: Array<[number[], number[], number[]]> = [
        [corner(0, w, 0), corner(-ABUTMENT_LEN, w, 0), [n[0], n[1], 0]],
        [corner(-ABUTMENT_LEN, -w, 0), corner(0, -w, 0), [-n[0], -n[1], 0]],
        [corner(0, -w, 0), corner(0, w, 0), [t[0], t[1], 0]],
      ];
      for (const [a, c, nrm] of faces) concrete.quad(a, c, [c[0], c[1], DECK_TOP], [a[0], a[1], DECK_TOP], nrm);
    }
  }

  // Ramps: the track drops from the bank back to the yard over the approach.
  for (const flatLine of b.a) {
    const ramp = toPts(flatLine);
    if (ramp.length < 2) continue;
    const cum = arcLengths(ramp);
    const total = cum[cum.length - 1] || 1;
    // Ease out, so the top of the bank rolls over instead of ending in a crease.
    const z = (i: number) => DECK_TOP * (1 - cum[i] / total) ** 2;
    bankSides(ramp, z, bank);
    tops.push(...trackSurfaces(ramp, z, b.e === 1, BALLAST_HW + 0.4));
  }
}

/** Earth slopes from the edges of a ballasted bank down to the ground, spread with its height. */
function bankSides(line: Pt[], z: (i: number) => number, bank: Mesh3) {
  for (const q of ribbon(line, z, () => BALLAST_HW + 0.4)) {
    for (const [a, c, dir] of [
      [q[0], q[1], -1],
      [q[3], q[2], 1],
    ] as Array<[number[], number[], number]>) {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const n = [((c[1] - a[1]) / len) * dir, (-(c[0] - a[0]) / len) * dir, 0];
      const foot = (v: number[]) => [v[0] + n[0] * v[2] * BATTER, v[1] + n[1] * v[2] * BATTER, 0];
      bank.quad(foot(a), foot(c), c, a, n);
    }
  }
}

/**
 * The LIRR and Amtrak lines along the north edge, up on their embankment, with girder bridges over
 * the streets and ramps down to the yard at each end.
 */
export function buildElevatedRail(data: Pick<MapData, 'elevatedRail'>, shadowMaterial: THREE.Material, sunOffset: THREE.Vector2): THREE.Group {
  const group = new THREE.Group();
  group.name = 'elevatedRail';
  const bridges = data.elevatedRail ?? [];
  if (!bridges.length) return group;

  const steel = new Mesh3();
  const concrete = new Mesh3();
  const bank = new Mesh3();
  const tops: Surface[] = [];
  const shadowLines: number[][] = [];
  for (const b of bridges) buildOne(b, steel, concrete, bank, tops, shadowLines);

  const objects: THREE.Object3D[] = [
    // The earth bank is darker than the concrete, so the rise out of the yard reads at a glance.
    new THREE.Mesh(bank.geometry, new THREE.MeshLambertMaterial({ color: '#6d6149', side: THREE.DoubleSide, emissive: '#221d16' })),
    new THREE.Mesh(concrete.geometry, new THREE.MeshLambertMaterial({ color: '#b3ab99', side: THREE.DoubleSide, emissive: '#2a2620' })),
    new THREE.Mesh(steel.geometry, new THREE.MeshLambertMaterial({ color: '#57675c', side: THREE.DoubleSide, emissive: '#1d221e' })),
  ];
  // One mesh per color, in the order the surfaces were stacked, so the rails sit over the ballast.
  for (const color of [COLORS.ballast, COLORS.thirdRail, COLORS.railSteel, COLORS.railBed]) {
    const geos = tops.filter((t) => t.c === color).map((t) => t.g);
    if (geos.length) objects.push(new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshBasicMaterial({ color })));
    geos.forEach((g) => g.dispose());
  }

  // Ground shadow: the deck outline shifted away from the sun.
  const shift = (p: number[]) => p.map((v, i) => v + (i % 2 === 0 ? sunOffset.x : sunOffset.y) * DECK_TOP * 0.6);
  objects.push(new THREE.Mesh(buildStrips(shadowLines.map((p) => ({ p: shift(p), hw: DECK_HW }))), shadowMaterial));

  for (const obj of objects) {
    obj.frustumCulled = false;
    group.add(obj);
  }
  return group;
}
