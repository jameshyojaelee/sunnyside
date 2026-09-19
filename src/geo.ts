// Geometry helpers shared by the browser app and the Node data scripts.
// World space: x = meters east, y = meters north of a fixed origin; z = up.

export type Pt = [number, number];

export interface Projection {
  toLocal(lon: number, lat: number): Pt;
  toLonLat(x: number, y: number): Pt;
}

/** Equirectangular projection around an origin; error is far below 1% over a few km. */
export function makeProjection(originLon: number, originLat: number): Projection {
  const phi = (originLat * Math.PI) / 180;
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mPerDegLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return {
    toLocal: (lon, lat) => [(lon - originLon) * mPerDegLon, (lat - originLat) * mPerDegLat],
    toLonLat: (x, y) => [originLon + x / mPerDegLon, originLat + y / mPerDegLat],
  };
}

/** Signed area; positive for counter-clockwise rings (y up). Ring may or may not repeat its first point. */
export function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Drops a repeated closing point and returns the ring counter-clockwise. */
export function normalizeRing(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  if (signedArea(out) < 0) out.reverse();
  return out;
}

export function pointInRing(x: number, y: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon = outer ring followed by hole rings. */
export function pointInPolygon(x: number, y: number, poly: Pt[][]): boolean {
  if (!pointInRing(x, y, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(x, y, poly[i])) return false;
  return true;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Parameter t in [0,1] of the closest point on segment ab to p. */
export function projectOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
}

/** Douglas-Peucker simplification of an open polyline. */
export function simplifyLine(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i][0], pts[i][1], pts[s][0], pts[s][1], pts[e][0], pts[e][1]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplifies a closed ring (no repeated closing point); returns null if it collapses. */
export function simplifyRing(ring: Pt[], tolerance: number): Pt[] | null {
  if (ring.length < 4) return ring.length >= 3 ? ring.slice() : null;
  // Split at the vertex farthest from vertex 0 so both halves are open polylines.
  let far = 1;
  let farD = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tolerance);
  const b = simplifyLine([...ring.slice(far), ring[0]], tolerance);
  const out = [...a, ...b.slice(1, -1)];
  return out.length >= 3 && Math.abs(signedArea(out)) > 1e-6 ? out : null;
}

/**
 * Joins OSM way fragments (lists of points; shared endpoints compared exactly) into closed rings.
 * Fragments that never close are dropped.
 */
export function stitchRings(fragments: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const pool = fragments.filter((f) => f.length >= 2).map((f) => f.slice());
  const rings: Pt[][] = [];
  while (pool.length) {
    let cur = pool.shift()!;
    let grew = true;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && grew) {
      grew = false;
      const end = key(cur[cur.length - 1]);
      for (let i = 0; i < pool.length; i++) {
        const f = pool[i];
        if (key(f[0]) === end) cur = cur.concat(f.slice(1));
        else if (key(f[f.length - 1]) === end) cur = cur.concat(f.slice().reverse().slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && key(cur[0]) === key(cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

export function ringCentroid(ring: Pt[]): Pt {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Distance from a point to a ring's boundary (0 on the edge). */
export function distToRing(x: number, y: number, ring: Pt[]): number {
  let d = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    d = Math.min(d, distToSegment(x, y, a[0], a[1], b[0], b[1]));
  }
  return d;
}

/** Deterministic PRNG (mulberry32) so decorative scatter is stable between runs. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round1 = (v: number) => Math.round(v * 10) / 10;
