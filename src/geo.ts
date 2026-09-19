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

/**
 * Joins open polylines that share endpoints into longer chains (e.g. OSM track pieces into whole
 * tracks). At a junction it continues along the piece that turns the least.
 */
export function stitchLines(lines: Pt[][], tolerance = 0.5): Pt[][] {
  const pool = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
  const heading = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const turn = (h1: number, h2: number) => {
    const d = Math.abs(h1 - h2) % (2 * Math.PI);
    return d > Math.PI ? 2 * Math.PI - d : d;
  };
  const chains: Pt[][] = [];
  while (pool.length) {
    let chain = pool.shift()!;
    // Extend forward, then flip and extend the other end.
    for (let pass = 0; pass < 2; pass++) {
      for (;;) {
        const end = chain[chain.length - 1];
        const h = heading(chain[chain.length - 2], end);
        let best = -1;
        let bestTurn = Math.PI / 3; // never follow a piece that doubles back
        let reversed = false;
        pool.forEach((l, i) => {
          for (const rev of [false, true]) {
            const seq = rev ? l.slice().reverse() : l;
            if (!near(seq[0], end)) continue;
            const t = turn(h, heading(seq[0], seq[1]));
            if (t < bestTurn) {
              bestTurn = t;
              best = i;
              reversed = rev;
            }
          }
        });
        if (best < 0) break;
        const next = pool.splice(best, 1)[0];
        chain = chain.concat((reversed ? next.slice().reverse() : next).slice(1));
      }
      chain.reverse();
    }
    chains.push(chain);
  }
  return chains;
}

/** Total length of a polyline. */
export function lineLength(line: Pt[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return s;
}

/**
 * Polygon covering everything north of a set of roughly west-east lines (e.g. a highway's
 * carriageways), `pad` meters above their northernmost edge, from x0 to x1 and up to y = top.
 * Beyond the lines' ends the edge continues flat at the nearest known height.
 */
export function regionNorthOf(lines: Pt[][], pad: number, x0: number, x1: number, top: number, step = 5): Pt[] {
  const edge = (x: number): number | null => {
    let best: number | null = null;
    for (const l of lines)
      for (let i = 0; i + 1 < l.length; i++) {
        const [ax, ay] = l[i];
        const [bx, by] = l[i + 1];
        if (ax === bx || x < Math.min(ax, bx) || x > Math.max(ax, bx)) continue;
        const y = ay + ((by - ay) * (x - ax)) / (bx - ax);
        best = best === null ? y : Math.max(best, y);
      }
    return best;
  };
  const xs: number[] = [];
  for (let x = x0; x < x1; x += step) xs.push(x);
  xs.push(x1);
  const ys = xs.map(edge);
  const known = ys.map((y, i) => (y === null ? -1 : i)).filter((i) => i >= 0);
  if (!known.length) throw new Error('regionNorthOf: lines do not span the range');
  const filled = ys.map((y, i) => {
    if (y !== null) return y;
    const nearest = known.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a));
    return ys[nearest]!;
  });
  const ring: Pt[] = xs.map((x, i) => [x, filled[i] + pad]);
  ring.push([x1, top], [x0, top]);
  return ring;
}

/** Arc-length positions along `line` where it crosses `other` (both open polylines). */
export function lineCrossings(line: Pt[], other: Pt[]): number[] {
  const out: number[] = [];
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    for (let j = 1; j < other.length; j++) {
      const [cx, cy] = other[j - 1];
      const [dx, dy] = other[j];
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-12) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(s + t * len);
    }
    s += len;
  }
  return out.sort((a, b) => a - b);
}

/** The piece of a polyline between arc lengths s0 and s1. */
export function sliceLine(line: Pt[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [];
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    const at = (d: number): Pt => [ax + ((bx - ax) * (d - s)) / (len || 1), ay + ((by - ay) * (d - s)) / (len || 1)];
    if (s + len >= s0 && s <= s1) {
      if (!out.length) out.push(at(Math.max(s0, s)));
      if (s + len <= s1) out.push([bx, by]);
      else {
        out.push(at(s1));
        break;
      }
    }
    s += len;
  }
  return out;
}

/** Arc length along `line` of the point nearest to p, and the distance to it. */
export function nearestOnLine(line: Pt[], p: Pt): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    const t = projectOnSegment(p[0], p[1], ax, ay, bx, by);
    const d = Math.hypot(p[0] - (ax + (bx - ax) * t), p[1] - (ay + (by - ay) * t));
    if (d < best.d) best = { s: s + t * len, d };
    s += len;
  }
  return best;
}

/**
 * Where a street meets a track: a true crossing if the lines intersect, otherwise the average
 * projection of street ends that stop within `gap` meters of it (streets often end at a wide avenue).
 */
export function streetMeetsLine(line: Pt[], streets: Pt[][], gap: number): number | undefined {
  const crossings = streets.flatMap((st) => lineCrossings(line, st));
  if (crossings.length) return crossings[0];
  const hits: number[] = [];
  for (const st of streets)
    for (const end of [st[0], st[st.length - 1]]) {
      const n = nearestOnLine(line, end);
      if (n.d <= gap) hits.push(n.s);
    }
  return hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : undefined;
}
