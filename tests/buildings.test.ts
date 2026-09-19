import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeProjection, pointInRing, type Pt } from '../src/geo.ts';
import type { Place } from '../src/places.ts';
import { shadowGeometry, wallGeometry } from '../src/render/buildings.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/places.json', import.meta.url), 'utf8')) as Place[];
const proj = makeProjection(-73.927829, 40.738077);
const ringOf = (p: Place): Pt[] => p.footprint.map(([lon, lat]) => proj.toLocal(lon, lat));

/** Is a point covered by any triangle of a flat geometry? */
function covered(g: THREE.BufferGeometry, x: number, y: number): boolean {
  const pos = g.getAttribute('position');
  const p = new THREE.Vector3(x, y, 0);
  const tri = new THREE.Triangle();
  for (let i = 0; i < pos.count; i += 3) {
    tri.set(
      new THREE.Vector3(pos.getX(i), pos.getY(i), 0),
      new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), 0),
      new THREE.Vector3(pos.getX(i + 2), pos.getY(i + 2), 0),
    );
    if (tri.containsPoint(p)) return true;
  }
  return false;
}

describe.each(fixtures.map((p) => [p.id, p] as const))('building %s', (_id, place) => {
  const ring = ringOf(place);

  it('has walls whose normals point out of the footprint (works for concave shapes)', () => {
    const g = wallGeometry(ring, place.height);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    for (let q = 0; q < pos.count; q += 6) {
      // Midpoint of the bottom edge of this wall quad.
      const mx = (pos.getX(q) + pos.getX(q + 1)) / 2;
      const my = (pos.getY(q) + pos.getY(q + 1)) / 2;
      const nx = nrm.getX(q);
      const ny = nrm.getY(q);
      expect(pointInRing(mx + nx * 0.2, my + ny * 0.2, ring)).toBe(false);
      expect(pointInRing(mx - nx * 0.2, my - ny * 0.2, ring)).toBe(true);
    }
  });

  it('winds each wall counter-clockwise as seen from outside', () => {
    const g = wallGeometry(ring, place.height);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const v = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    for (let t = 0; t < pos.count; t += 3) {
      const face = new THREE.Vector3().crossVectors(v(t + 1).sub(v(t)), v(t + 2).sub(v(t)));
      expect(face.dot(new THREE.Vector3(nrm.getX(t), nrm.getY(t), 0))).toBeGreaterThan(0);
    }
  });

  it('casts a shadow that covers the footprint and its shifted copy', () => {
    const off = new THREE.Vector2(6, -4);
    const g = shadowGeometry(ring, off);
    // Sample points just inside each corner (toward the centroid) of both footprints.
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    for (const [x, y] of ring) {
      const ix = x + (cx - x) * 0.05;
      const iy = y + (cy - y) * 0.05;
      if (!pointInRing(ix, iy, ring)) continue;
      expect(covered(g, ix, iy)).toBe(true);
      expect(covered(g, ix + off.x, iy + off.y)).toBe(true);
    }
  });
});

describe('drive-thru pickup window', () => {
  it('goes on the wall the lane runs alongside, not at a corner where it turns', async () => {
    const { pickupSpot } = await import('../src/render/lot.ts');
    // 10 x 20 m building; lane runs down its west side (x = -3) from north to south, then turns east.
    const ring: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 20],
      [0, 20],
    ];
    const lane: Pt[] = [
      [-3, 30],
      [-3, -3],
      [12, -3],
    ];
    const spot = pickupSpot(lane, ring);
    expect(spot.edge).toBe(3); // west wall: (0,20) -> (0,0)
    expect(spot.dist).toBeCloseTo(3, 5);
  });
});
