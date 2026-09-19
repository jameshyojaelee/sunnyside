import { describe, expect, it } from 'vitest';
import { awningSpan, chooseFacadeEdge, nearestEdge, separateSpans, streetOf, type NamedRoad } from '../src/facade.ts';
import type { Pt } from '../src/geo.ts';

// A 20 x 30 m corner building (counter-clockwise) at the corner of "Main Street" (runs along y = -8,
// south of the building) and "Queens Boulevard" (runs along x = 28, east of the building).
const ring: Pt[] = [
  [0, 0],
  [20, 0],
  [20, 30],
  [0, 30],
];
const roads: NamedRoad[] = [
  { n: 'Main Street', w: 10, p: [-100, -8, 100, -8] },
  { n: 'Queens Boulevard', w: 12, p: [28, -100, 28, 100] },
];

describe('chooseFacadeEdge', () => {
  it('uses the wall next to the click when one is right there', () => {
    expect(chooseFacadeEdge(ring, [10, 1], roads)).toBe(0); // south wall, Main Street
    expect(chooseFacadeEdge(ring, [19, 15], roads)).toBe(1); // east wall, Queens Blvd
  });

  it('in a corner, prefers the wall on the street named in the address', () => {
    const corner: Pt = [15, 5]; // 5 m from both street walls
    expect(chooseFacadeEdge(ring, corner, roads, '44-11 Queens Boulevard')).toBe(1);
    expect(chooseFacadeEdge(ring, corner, roads, '100 Main St')).toBe(0);
  });

  it('never picks a back wall that faces no street', () => {
    const e = chooseFacadeEdge(ring, [10, 20], roads);
    expect([0, 1]).toContain(e);
  });

  it('nearestEdge finds the closest wall', () => {
    expect(nearestEdge(ring, [-1, 15])).toBe(3);
  });

  it('streetOf normalizes common suffixes', () => {
    expect(streetOf('44-11 Queens Boulevard')).toBe('queens blvd');
    expect(streetOf('43-30 46th Street')).toBe('46th st');
  });
});

describe('awning spans', () => {
  it('centers on the storefront and stays on the wall', () => {
    const s = awningSpan(ring, 0, [10, 0.5], 7); // wall length 20
    expect((s.t0 + s.t1) / 2).toBeCloseTo(0.5, 5);
    expect((s.t1 - s.t0) * s.len).toBeCloseTo(7, 5);
    const edge = awningSpan(ring, 0, [0.2, 0.5], 7);
    expect(edge.t0 * edge.len).toBeCloseTo(0.3, 5);
  });

  it('pulls apart two awnings that would overlap', () => {
    const a = awningSpan(ring, 0, [8, 0.5], 7);
    const b = awningSpan(ring, 0, [12, 0.5], 7);
    separateSpans([a, b]);
    expect(b.t0 * b.len - a.t1 * a.len).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });
});
