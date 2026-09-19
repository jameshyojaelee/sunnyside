// Carving one shop's slice ("unit") out of a big OSM building that holds many shops.
import polygonClipping, { type Polygon } from 'polygon-clipping';
import { distToSegment, normalizeRing, pointInRing, projectOnSegment, signedArea, simplifyRing, type Pt } from './geo.ts';

const MIN_W = 4;
const MAX_W = 14;
const DEFAULT_W = 7;

/**
 * Where along wall `edge` (meters from its start) this shop's front runs: halfway to the
 * neighboring shops on each side, from their positions along the same wall.
 */
export function unitSpan(ring: Pt[], edge: number, storefront: Pt, neighbors: Pt[]): { s0: number; s1: number } {
  const a = ring[edge];
  const b = ring[(edge + 1) % ring.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const along = (p: Pt) => projectOnSegment(p[0], p[1], a[0], a[1], b[0], b[1]) * len;
  const s = along(storefront);
  // Only neighbors whose shops open onto this same wall.
  const on = neighbors.filter((p) => distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]) < 6).map(along);
  // A neighbor farther than two shop widths away likely has unmapped shops in between: ignore it.
  const near = on.filter((x) => Math.abs(x - s) <= 2 * DEFAULT_W);
  const before = near.filter((x) => x < s - 0.5).sort((x, y) => y - x)[0];
  const after = near.filter((x) => x > s + 0.5).sort((x, y) => x - y)[0];
  let s0 = before !== undefined ? (before + s) / 2 : s - DEFAULT_W / 2;
  let s1 = after !== undefined ? (after + s) / 2 : s + DEFAULT_W / 2;
  // Keep a believable shop width and stay on the wall.
  if (s1 - s0 < MIN_W) {
    const grow = (MIN_W - (s1 - s0)) / 2;
    s0 -= grow;
    s1 += grow;
  }
  if (s1 - s0 > MAX_W) {
    s0 = Math.max(s0, s - MAX_W / 2);
    s1 = s0 + MAX_W;
  }
  s0 = Math.max(0, s0);
  s1 = Math.min(len, s1);
  return { s0, s1 };
}

/** The part of the building behind wall `edge` between s0 and s1, `depth` meters deep. */
export function carveUnit(ring: Pt[], edge: number, s0: number, s1: number, depth = 15): Pt[] {
  const a = ring[edge];
  const b = ring[(edge + 1) % ring.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const inward: Pt = [-d[1], d[0]]; // left of a->b is inside a counter-clockwise ring
  const at = (s: number, k: number): [number, number] => [a[0] + d[0] * s + inward[0] * k, a[1] + d[1] * s + inward[1] * k];
  // Start a hair outside the wall so the slice keeps the whole shop front.
  const rect: [number, number][] = [at(s0, -0.05), at(s1, -0.05), at(s1, depth), at(s0, depth), at(s0, -0.05)];
  const closed: [number, number][] = [...ring, ring[0]].map(([x, y]) => [x, y]);
  const pieces = polygonClipping.intersection([closed] as Polygon, [rect] as Polygon);
  let best: Pt[] = [];
  for (const poly of pieces) {
    const r = normalizeRing(poly[0] as Pt[]);
    if (Math.abs(signedArea(r)) > Math.abs(signedArea(best))) best = r;
  }
  if (best.length < 3) throw new Error('Could not carve a unit from this building');
  return simplifyRing(best, 0.3) ?? best;
}

/** Named places (OSM shops) that sit inside the building: 3+ means it holds several businesses. */
export function shopsInside(ring: Pt[], pois: Array<{ x: number; y: number }>): Pt[] {
  return pois.filter((p) => pointInRing(p.x, p.y, ring)).map((p) => [p.x, p.y] as Pt);
}
