import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildElevatedRail, ELEVATED_RAIL_TOP } from '../src/render/elevatedRail.ts';

const shadow = new THREE.MeshBasicMaterial();
const sun = new THREE.Vector2(0.5, -0.4);

/** A 200 m run with a girder span across the middle 20 m and a ramp off each end. */
const run = {
  p: [0, 0, 200, 0],
  s: [[90, 0, 110, 0]],
  k: [
    [0, 0, 90, 0],
    [110, 0, 200, 0],
  ],
  a: [
    [0, 0, -90, 0],
    [200, 0, 290, 0],
  ],
};

/** Every vertex of every mesh in the group, as [x, y, z]. */
function vertices(group: THREE.Group): number[][] {
  const out: number[][] = [];
  group.traverse((o) => {
    const pos = (o as THREE.Mesh).geometry?.getAttribute?.('position');
    if (pos) for (let i = 0; i < pos.count; i++) out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  });
  return out;
}

describe('elevated rail', () => {
  const pts = vertices(buildElevatedRail({ elevatedRail: [run] }, shadow, sun));

  it('carries the track at deck height along the run, and nothing above it', () => {
    // The rails sit just proud of the ballast; nothing else rises above the deck.
    expect(Math.max(...pts.map((p) => p[2]))).toBeCloseTo(ELEVATED_RAIL_TOP + 0.09, 2);
    const atStart = pts.filter((p) => Math.abs(p[0]) < 0.01);
    expect(atStart.filter((p) => p[2] > ELEVATED_RAIL_TOP - 0.01).length).toBeGreaterThan(4);
  });

  it('brings the ramps down to the ground at their far ends', () => {
    const farEnd = pts.filter((p) => p[0] < -85 || p[0] > 285);
    expect(farEnd.length).toBeGreaterThan(0);
    expect(Math.max(...farEnd.map((p) => p[2]))).toBeLessThan(0.2);
  });

  it('leaves the girder span open instead of banking earth across the street', () => {
    // The bank's slopes spread out well past the deck, and they stop at each end of the span, so
    // the street runs through underneath instead of into a wall of fill.
    const feet = pts.filter((p) => Math.abs(p[1]) > 5);
    expect(feet.length).toBeGreaterThan(0);
    expect(new Set(feet.map((p) => Math.round(p[0])))).toEqual(new Set([0, 90, 110, 200]));
  });
});
