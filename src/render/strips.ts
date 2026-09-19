import * as THREE from 'three';

export interface StripLine {
  /** Flat polyline [x0, y0, x1, y1, ...]. */
  p: number[];
  /** Half width in meters. */
  hw: number;
}

/**
 * Flat ribbons with round joins and caps: one quad per segment plus a disc at every endpoint and
 * bend. Drawn in a single color per layer, overlapping pieces merge invisibly, which is what makes
 * road intersections clean.
 */
export function buildStrips(lines: StripLine[], z = 0, discSegments = 10): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const disc = (cx: number, cy: number, r: number) => {
    const c = pos.length / 3;
    pos.push(cx, cy, z);
    for (let k = 0; k < discSegments; k++) {
      const a = (k / discSegments) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
    }
    for (let k = 0; k < discSegments; k++) idx.push(c, c + 1 + k, c + 1 + ((k + 1) % discSegments));
  };

  for (const { p, hw } of lines) {
    if (hw <= 0 || p.length < 4) continue;
    const n = p.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const ax = p[2 * i];
      const ay = p[2 * i + 1];
      const bx = p[2 * i + 2];
      const by = p[2 * i + 3];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = (-dy / len) * hw;
      const ny = (dx / len) * hw;
      const b = pos.length / 3;
      pos.push(ax + nx, ay + ny, z, ax - nx, ay - ny, z, bx - nx, by - ny, z, bx + nx, by + ny, z);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    for (let i = 0; i < n; i++) {
      let bend = true;
      if (i > 0 && i < n - 1) {
        const a1 = Math.atan2(p[2 * i + 1] - p[2 * i - 1], p[2 * i] - p[2 * i - 2]);
        const a2 = Math.atan2(p[2 * i + 3] - p[2 * i + 1], p[2 * i + 2] - p[2 * i]);
        let d = Math.abs(a2 - a1);
        if (d > Math.PI) d = 2 * Math.PI - d;
        bend = d > (3 * Math.PI) / 180;
      }
      if (bend) disc(p[2 * i], p[2 * i + 1], hw);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  return g;
}
