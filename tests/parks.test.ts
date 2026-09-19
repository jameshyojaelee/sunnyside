import { describe, expect, it } from 'vitest';
import { corridorPieces, nearestOnRing, offsetLine } from '../src/corridor.ts';
import type { Pt } from '../src/geo.ts';
import { courtFrame, flipFrame, at } from '../src/render/courts.ts';

const square: Pt[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('corridor', () => {
  it('finds the nearest point on a ring', () => {
    expect(nearestOnRing(square, [5, -4])).toEqual([5, 0]);
    expect(nearestOnRing(square, [12, 12])).toEqual([10, 10]);
  });

  it('offsets a line to its left', () => {
    expect(offsetLine([[0, 0], [10, 0]], 2)).toEqual([
      [0, 2],
      [10, 2],
    ]);
  });

  it('covers a nearby track with a band and joins it to the boundary', () => {
    const track: Pt[] = [
      [0, 20],
      [10, 20],
    ];
    const dist = (p: Pt) => Math.abs(p[1] - 10);
    const { bands, between } = corridorPieces([track], square, dist, 30, 5);
    expect(bands).toHaveLength(1);
    // The band reaches 5 m either side of the track.
    const ys = bands[0][0].map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(15, 5);
    expect(Math.max(...ys)).toBeCloseTo(25, 5);
    // And the ground between the track and the ring is filled in.
    expect(between.length).toBeGreaterThan(0);
    expect(between.flat(2).some((p) => p[1] === 10)).toBe(true);
  });

  it('leaves faraway track alone', () => {
    const far: Pt[] = [
      [0, 500],
      [10, 500],
    ];
    expect(corridorPieces([far], square, (p) => Math.abs(p[1] - 10), 30, 5).bands).toHaveLength(0);
  });
});

describe('courtFrame', () => {
  // A 20 x 10 m court, turned 30 degrees.
  const a = Math.PI / 6;
  const rot = ([x, y]: Pt): Pt => [x * Math.cos(a) - y * Math.sin(a) + 100, x * Math.sin(a) + y * Math.cos(a) - 50];
  const court = ([
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
  ] as Pt[]).map(rot);

  it('fits the court rectangle with u along the long side', () => {
    const f = courtFrame(court);
    expect(f.L).toBeCloseTo(20, 5);
    expect(f.W).toBeCloseTo(10, 5);
    expect(Math.hypot(...at(f, 0, 0).map((v, i) => v - rot([0, 0])[i]) as [number, number])).toBeLessThan(1e-6);
  });

  it('flipping puts u = 0 at the far end', () => {
    const f = flipFrame(courtFrame(court));
    const end = at(f, 0, 0);
    const far = rot([20, 10]);
    expect(Math.hypot(end[0] - far[0], end[1] - far[1])).toBeLessThan(1e-6);
    expect(f.L).toBeCloseTo(20, 5);
  });
});
