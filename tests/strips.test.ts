import { describe, expect, it } from 'vitest';
import { distToSegment } from '../src/geo.ts';
import { buildStrips } from '../src/render/strips.ts';

describe('buildStrips', () => {
  const line = { p: [0, 0, 100, 0, 100, 50], hw: 5 };
  const g = buildStrips([line], 0, 8);
  const pos = g.getAttribute('position');

  it('emits two quads plus discs at both ends and the bend', () => {
    // 2 segments x 4 verts + 3 discs x (1 + 8) verts
    expect(pos.count).toBe(2 * 4 + 3 * 9);
    expect(g.getIndex()!.count).toBe(2 * 6 + 3 * 8 * 3);
  });

  it('keeps every vertex within half-width of the centerline', () => {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const d = Math.min(distToSegment(x, y, 0, 0, 100, 0), distToSegment(x, y, 100, 0, 100, 50));
      expect(d).toBeLessThanOrEqual(5 + 1e-4); // float32 storage
    }
  });

  it('faces up (counter-clockwise seen from +z) so the ground is visible from above', () => {
    const idx = g.getIndex()!;
    for (let t = 0; t < 6; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const cross =
        (pos.getX(b) - pos.getX(a)) * (pos.getY(c) - pos.getY(a)) - (pos.getY(b) - pos.getY(a)) * (pos.getX(c) - pos.getX(a));
      expect(cross).toBeGreaterThan(0);
    }
  });

  it('skips straight-through joints (no disc)', () => {
    const straight = buildStrips([{ p: [0, 0, 50, 0, 100, 0], hw: 3 }], 0, 8);
    expect(straight.getAttribute('position').count).toBe(2 * 4 + 2 * 9);
  });
});
