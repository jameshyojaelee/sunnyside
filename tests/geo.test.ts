import { describe, expect, it } from 'vitest';
import {
  makeProjection,
  normalizeRing,
  pointInPolygon,
  signedArea,
  simplifyLine,
  simplifyRing,
  stitchRings,
  type Pt,
} from '../src/geo.ts';

describe('projection', () => {
  const proj = makeProjection(-73.9278, 40.7381);

  it('round-trips lon/lat within 1 cm across the neighborhood', () => {
    for (const [lon, lat] of [
      [-73.9459, 40.7259],
      [-73.9097, 40.7502],
      [-73.9186, 40.7432],
    ]) {
      const [x, y] = proj.toLocal(lon, lat);
      const [lon2, lat2] = proj.toLonLat(x, y);
      const back = proj.toLocal(lon2, lat2);
      expect(Math.hypot(back[0] - x, back[1] - y)).toBeLessThan(0.01);
      expect(Math.abs(lon2 - lon)).toBeLessThan(1e-9);
      expect(Math.abs(lat2 - lat)).toBeLessThan(1e-9);
    }
  });

  it('matches known distances: 0.001 deg lat ~ 111 m, 0.001 deg lon ~ 84 m at 40.74 N', () => {
    const [, y] = proj.toLocal(-73.9278, 40.7391);
    const [x] = proj.toLocal(-73.9268, 40.7381);
    expect(y).toBeGreaterThan(110.9);
    expect(y).toBeLessThan(111.2);
    expect(x).toBeGreaterThan(84.0);
    expect(x).toBeLessThan(84.6);
  });
});

describe('rings', () => {
  const cwSquare: Pt[] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
    [0, 0],
  ];

  it('normalizes to CCW without the closing point', () => {
    const r = normalizeRing(cwSquare);
    expect(r).toHaveLength(4);
    expect(signedArea(r)).toBe(100);
  });

  it('drops consecutive duplicate points', () => {
    const r = normalizeRing([
      [0, 0],
      [10, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
    expect(r).toHaveLength(4);
  });

  it('point in polygon respects holes', () => {
    const outer: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const hole: Pt[] = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ];
    expect(pointInPolygon(2, 2, [outer, hole])).toBe(true);
    expect(pointInPolygon(5, 5, [outer, hole])).toBe(false);
    expect(pointInPolygon(11, 5, [outer, hole])).toBe(false);
  });
});

describe('simplify', () => {
  it('removes near-collinear jitter but keeps corners', () => {
    const line: Pt[] = [
      [0, 0],
      [5, 0.1],
      [10, 0],
      [10, 10],
    ];
    expect(simplifyLine(line, 0.5)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it('keeps an L-shaped footprint as 6 corners', () => {
    const L: Pt[] = [
      [0, 0],
      [20, 0],
      [20, 0.2],
      [20, 8],
      [8, 8],
      [8, 20],
      [0, 20],
    ];
    const s = simplifyRing(L, 0.75)!;
    expect(s).toHaveLength(6);
    expect(Math.abs(signedArea(s))).toBeCloseTo(20 * 8 + 8 * 12, 0);
  });
});

describe('stitchRings', () => {
  it('joins fragments in any direction into a closed ring', () => {
    const a: Pt[] = [
      [0, 0],
      [10, 0],
    ];
    const b: Pt[] = [
      [10, 10],
      [10, 0],
    ]; // reversed
    const c: Pt[] = [
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const rings = stitchRings([a, b, c]);
    expect(rings).toHaveLength(1);
    expect(Math.abs(signedArea(normalizeRing(rings[0])))).toBe(100);
  });

  it('drops fragments that never close', () => {
    expect(
      stitchRings([
        [
          [0, 0],
          [1, 0],
        ],
      ]),
    ).toHaveLength(0);
  });
});

describe('stitchLines', () => {
  it('joins pieces end to end regardless of direction', async () => {
    const { stitchLines, lineLength } = await import('../src/geo.ts');
    const chains = stitchLines([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [20, 0],
        [10, 0],
      ],
      [
        [20, 0],
        [30, 1],
      ],
    ]);
    expect(chains).toHaveLength(1);
    expect(lineLength(chains[0])).toBeCloseTo(30.05, 1);
  });

  it('at a junction follows the straightest continuation, not the crossover', async () => {
    const { stitchLines } = await import('../src/geo.ts');
    const chains = stitchLines([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [10, 0],
        [20, 4],
      ], // crossover, turns ~22 degrees
      [
        [10, 0],
        [20, 0],
      ], // straight on
    ]);
    const main = chains.find((c) => c.length === 3)!;
    expect(main[2]).toEqual([20, 0]);
  });
});

describe('regionNorthOf', () => {
  it('follows the northernmost of two carriageways and extends flat past their ends', async () => {
    const { regionNorthOf, pointInRing } = await import('../src/geo.ts');
    const south: Pt[] = [
      [0, 0],
      [100, -50],
    ];
    const north: Pt[] = [
      [0, 10],
      [100, -40],
    ];
    const r = regionNorthOf([south, north], 5, -50, 150, 500, 1);
    expect(pointInRing(50, -15 + 6, r)).toBe(true); // just above north edge (y=-15) + pad 5
    expect(pointInRing(50, -15 + 4, r)).toBe(false); // inside the pad
    expect(pointInRing(-40, 16, r)).toBe(true); // west of the lines: flat at y = 10 + 5
    expect(pointInRing(-40, 14, r)).toBe(false);
  });
});
