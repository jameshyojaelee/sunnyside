import { describe, expect, it } from 'vitest';
import { pointInRing, signedArea, type Pt } from '../src/geo.ts';
import { carveUnit, unitSpan } from '../src/units.ts';

// A 40 m x 30 m block (counter-clockwise); its front, wall 0, runs along y = 0 from x = 0 to 40.
const block: Pt[] = [
  [0, 0],
  [40, 0],
  [40, 30],
  [0, 30],
];

describe('unitSpan', () => {
  it('splits halfway to the neighboring shops on the same wall', () => {
    const neighbors: Pt[] = [
      [4, 1],
      [16, 1],
      [30, 25], // opens onto the back, ignored
    ];
    const { s0, s1 } = unitSpan(block, 0, [10, 1], neighbors);
    expect(s0).toBeCloseTo(7, 6);
    expect(s1).toBeCloseTo(13, 6);
  });

  it('falls back to a 7 m front without neighbors and keeps it on the wall', () => {
    expect(unitSpan(block, 0, [20, 1], [])).toEqual({ s0: 16.5, s1: 23.5 });
    expect(unitSpan(block, 0, [1, 1], []).s0).toBe(0);
  });

  it('never makes a shop narrower than 4 m', () => {
    const { s0, s1 } = unitSpan(block, 0, [10, 1], [
      [9, 1],
      [11, 1],
    ]);
    expect(s1 - s0).toBeCloseTo(4, 6);
  });
});

describe('carveUnit', () => {
  it('cuts the shop slice out of the block, 15 m deep, counter-clockwise', () => {
    const unit = carveUnit(block, 0, 7, 13);
    expect(signedArea(unit)).toBeGreaterThan(0);
    expect(Math.abs(signedArea(unit))).toBeCloseTo(6 * 15.05, 0);
    expect(pointInRing(10, 5, unit)).toBe(true);
    expect(pointInRing(20, 5, unit)).toBe(false);
    expect(pointInRing(10, 20, unit)).toBe(false);
  });

  it('stays inside a shallow building', () => {
    const shallow: Pt[] = [
      [0, 0],
      [40, 0],
      [40, 8],
      [0, 8],
    ];
    const unit = carveUnit(shallow, 0, 7, 13);
    expect(Math.max(...unit.map((p) => p[1]))).toBeCloseTo(8, 6);
  });
});
