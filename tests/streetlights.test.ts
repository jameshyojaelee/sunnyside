import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pointInRing, type Pt } from '../src/geo.ts';
import type { MapData } from '../src/mapdata.ts';
import { lampPositions } from '../src/render/streetlights.ts';

const data = JSON.parse(readFileSync(new URL('../public/data/sunnyside.json', import.meta.url), 'utf8')) as MapData;
const lamps = lampPositions(data);
const rings = data.boundary.map((poly) => {
  const flat = poly[0];
  const ring: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
  return ring;
});

describe('streetlights', () => {
  it('lines the streets of the whole neighborhood', () => {
    expect(lamps.length).toBeGreaterThan(1000);
  });

  it('never stands outside Sunnyside', () => {
    for (const l of lamps) expect(rings.some((r) => pointInRing(l.x, l.y, r))).toBe(true);
  });

  it('keeps clear of the street trees', () => {
    const near = lamps.filter((l) => {
      for (let i = 0; i < data.trees.length; i += 4) if (Math.hypot(data.trees[i] - l.x, data.trees[i + 1] - l.y) < 3.4) return true;
      return false;
    });
    expect(near).toEqual([]);
  });

  it('points its arm sideways from the post, as a unit vector', () => {
    for (const l of lamps.slice(0, 200)) expect(Math.hypot(l.ax, l.ay)).toBeCloseTo(1, 6);
  });
});
