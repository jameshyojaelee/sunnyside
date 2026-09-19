import { distToSegment, normalizeRing, projectOnSegment, simplifyRing, type Pt } from './geo.ts';

/** Index of the wall (ring[i] -> ring[i+1]) closest to a point. */
export function nearestEdge(ring: Pt[], p: Pt): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const d = distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface NamedRoad {
  n?: string;
  w: number;
  p: number[];
}

const normStreet = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bplace\b/g, 'pl')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The street name part of an address like "44-11 Queens Boulevard". */
export function streetOf(address: string): string {
  return normStreet(address.replace(/^[\d-]+[a-z]?\s+/i, ''));
}

/** Gap between a point and the nearest road's curb, and that road's name. */
function nearestRoad(roads: NamedRoad[], x: number, y: number): { gap: number; name?: string } {
  let gap = Infinity;
  let name: string | undefined;
  for (const r of roads) {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const d = distToSegment(x, y, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]) - r.w / 2;
      if (d < gap) {
        gap = d;
        name = r.n;
      }
    }
  }
  return { gap, name };
}

/**
 * Picks the storefront wall. Walls facing the street named in the address win. Otherwise, when
 * the click is right next to a wall, choose among the walls about that close the one that faces a
 * street (a click in a corner notch should not pick a set-back wall); failing that, prefer
 * street-facing walls near the click.
 */
export function chooseFacadeEdge(ring: Pt[], storefront: Pt, roads: NamedRoad[], address?: string): number {
  const street = address ? streetOf(address) : '';
  const walls = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Outward normal of a counter-clockwise ring is on the right of a -> b.
    const nx = len ? (b[1] - a[1]) / len : 0;
    const ny = len ? -(b[0] - a[0]) / len : 0;
    const road = nearestRoad(roads, (a[0] + b[0]) / 2 + nx * 5, (a[1] + b[1]) / 2 + ny * 5);
    const matches = !!street && !!road.name && normStreet(road.name) === street;
    return { i, len, d: distToSegment(storefront[0], storefront[1], a[0], a[1], b[0], b[1]), gap: Math.max(0, road.gap), matches };
  });
  const usable = walls.filter((w) => w.len >= 2);
  if (!usable.length) return nearestEdge(ring, storefront);
  // A shop's address names the street its door faces: if a wall faces that street, use it
  // (the one nearest the click if several do), even when the click landed by a side wall.
  const onStreet = usable.filter((w) => w.matches && w.gap < 12);
  if (onStreet.length) return onStreet.reduce((a, b) => (b.d < a.d ? b : a)).i;
  const dmin = Math.min(...usable.map((w) => w.d));
  const pool = dmin < 2.5 ? usable.filter((w) => w.d < dmin + 1.5) : usable;
  const score = (w: (typeof walls)[number]) => (dmin < 2.5 ? w.gap + w.d * 0.1 : w.d + 1.5 * w.gap) - (w.matches ? 12 : 0);
  return pool.reduce((best, w) => (score(w) < score(best) ? w : best)).i;
}

/** Awning span along wall `edge`: centered on the storefront, clamped to fit the wall. */
export function awningSpan(ring: Pt[], edge: number, storefront: Pt, maxWidth = 7): { t0: number; t1: number; len: number } {
  const a = ring[edge];
  const b = ring[(edge + 1) % ring.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const width = Math.min(maxWidth, Math.max(1, len - 0.6));
  const center = projectOnSegment(storefront[0], storefront[1], a[0], a[1], b[0], b[1]) * len;
  const s0 = Math.min(Math.max(center - width / 2, 0.3), Math.max(0.3, len - 0.3 - width));
  return { t0: s0 / len, t1: Math.min(1, (s0 + width) / len), len };
}

/** Cleans a raw OSM outline for use as a place footprint: counter-clockwise, simplified to 0.75 m. */
export function prepareFootprint(ring: Pt[]): Pt[] {
  const r = normalizeRing(ring);
  return simplifyRing(r, 0.75) ?? r;
}

/** Spreads awnings that share a wall so they don't overlap (spans are fractions of the wall). */
export function separateSpans(spans: Array<{ t0: number; t1: number; len: number }>, gapMeters = 0.4): void {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].t0 - spans[b].t0);
  for (let k = 1; k < order.length; k++) {
    const prev = spans[order[k - 1]];
    const cur = spans[order[k]];
    const gap = gapMeters / cur.len;
    if (cur.t0 < prev.t1 + gap) {
      const mid = (prev.t1 + cur.t0) / 2;
      prev.t1 = Math.max(prev.t0 + 0.05, mid - gap / 2);
      cur.t0 = Math.min(cur.t1 - 0.05, mid + gap / 2);
    }
  }
}
