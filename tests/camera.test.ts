import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyToCamera, fitScale, screenToGround, worldToScreen, type ViewState } from '../src/camera.ts';

const vp = { width: 1200, height: 800 };

describe('dimetric camera', () => {
  it('projects a 45-degree-rotated ground square 2:1', () => {
    const v: ViewState = { tx: 0, ty: 0, scale: 4, azimuth: Math.PI / 4 };
    // Square aligned with world axes; at azimuth 45 deg it appears as a diamond.
    const pts = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ].map(([x, y]) => worldToScreen(v, vp, x, y));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(w / h).toBeCloseTo(2, 6);
  });

  for (const k of [0, 1, 2, 3]) {
    it(`screen -> ground -> screen round-trips at rotation ${k}`, () => {
      const v: ViewState = { tx: 120, ty: -340, scale: 2.7, azimuth: 0.3 + (k * Math.PI) / 2 };
      for (const [sx, sy] of [
        [0, 0],
        [600, 400],
        [1199, 13],
        [250, 777],
      ]) {
        const [gx, gy] = screenToGround(v, vp, sx, sy);
        const [sx2, sy2] = worldToScreen(v, vp, gx, gy);
        expect(sx2).toBeCloseTo(sx, 6);
        expect(sy2).toBeCloseTo(sy, 6);
      }
    });

    it(`matches three.js OrthographicCamera projection at rotation ${k}`, () => {
      const v: ViewState = { tx: 50, ty: 80, scale: 3.1, azimuth: 1.1 + (k * Math.PI) / 2 };
      const cam = new THREE.OrthographicCamera();
      applyToCamera(cam, v, vp);
      for (const [x, y, z] of [
        [50, 80, 0],
        [130, -20, 0],
        [-70, 160, 18],
      ]) {
        const ndc = new THREE.Vector3(x, y, z).project(cam);
        const sx = ((ndc.x + 1) / 2) * vp.width;
        const sy = ((1 - ndc.y) / 2) * vp.height;
        const [ex, ey] = worldToScreen(v, vp, x, y, z);
        expect(sx).toBeCloseTo(ex, 4);
        expect(sy).toBeCloseTo(ey, 4);
      }
    });
  }

  it('fitScale makes all bounds corners visible', () => {
    const bounds = { minX: -1500, minY: -1300, maxX: 1500, maxY: 1300 };
    const az = 0.7;
    const s = fitScale(vp, az, bounds);
    const v: ViewState = { tx: 0, ty: 0, scale: s, azimuth: az };
    for (const [x, y] of [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.maxY],
      [bounds.minX, bounds.maxY],
      [bounds.maxX, bounds.minY],
    ]) {
      const [sx, sy] = worldToScreen(v, vp, x, y);
      expect(sx).toBeGreaterThanOrEqual(-1e-6);
      expect(sx).toBeLessThanOrEqual(vp.width + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(-1e-6);
      expect(sy).toBeLessThanOrEqual(vp.height + 1e-6);
    }
  });
});
