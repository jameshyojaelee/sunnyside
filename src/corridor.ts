// The rail corridor just outside Sunnyside's north edge (Sunnyside Yard and the LIRR lines).
// The map fades to forest outside the neighborhood; this band is kept visible so the tracks show.
import type { Polygon } from 'polygon-clipping';
import { projectOnSegment, type Pt } from './geo.ts';

/** Closest point to p on a closed ring. */
export function nearestOnRing(ring: Pt[], p: Pt): Pt {
  let best: Pt = ring[0];
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const t = projectOnSegment(p[0], p[1], a[0], a[1], b[0], b[1]);
    const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** The polyline shifted sideways by d meters (positive = left of the direction of travel). */
export function offsetLine(line: Pt[], d: number): Pt[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / len) * d, p[1] + ((b[0] - a[0]) / len) * d];
  });
}

// Snapped to 0.1 m: polygon-clipping fails on near-coincident edges between thousands of pieces.
const snap = (v: number) => Math.round(v * 10) / 10;
const ring = (pts: Pt[]): [number, number][] => [...pts, pts[0]].map(([x, y]) => [snap(x), snap(y)]);

/**
 * Pieces covering every track segment within `maxDist` of the boundary: `bands` are `halfWidth`
 * wide around the tracks (the ballast), `between` is the ground from the track back to the
 * boundary, so the corridor joins the neighborhood instead of floating in the forest.
 */
export function corridorPieces(
  tracks: Pt[][],
  outline: Pt[],
  distTo: (p: Pt) => number,
  maxDist: number,
  halfWidth: number,
): { bands: Polygon[]; between: Polygon[] } {
  const bands: Polygon[] = [];
  const between: Polygon[] = [];
  for (const t of tracks)
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1];
      const b = t[i];
      if (distTo(a) > maxDist && distTo(b) > maxDist) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const nx = (-(b[1] - a[1]) / len) * halfWidth;
      const ny = ((b[0] - a[0]) / len) * halfWidth;
      const ux = ((b[0] - a[0]) / len) * halfWidth;
      const uy = ((b[1] - a[1]) / len) * halfWidth;
      // Band around the segment, reaching past both ends so consecutive pieces overlap.
      bands.push([ring([[a[0] + nx - ux, a[1] + ny - uy], [b[0] + nx + ux, b[1] + ny + uy], [b[0] - nx + ux, b[1] - ny + uy], [a[0] - nx - ux, a[1] - ny - uy]])]);
      // Ground between the segment and the boundary: two triangles are always simple polygons.
      const na = nearestOnRing(outline, a);
      const nb = nearestOnRing(outline, b);
      for (const tri of [[a, b, nb], [a, nb, na]] as Pt[][]) {
        const area = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
        if (Math.abs(area) > 0.5) between.push([ring(tri)]);
      }
    }
  return { bands, between };
}
