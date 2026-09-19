import * as THREE from 'three';
import { buildStrips } from './strips.ts';

export const VIADUCT_DECK_TOP = 8.6;
const DECK_TOP = VIADUCT_DECK_TOP;
const DECK_BOTTOM = 7.4;
const HALF_WIDTH = 2.7;
const PILLAR_SPACING = 20;

/** Elevated subway structure (the 7 train over Queens Blvd): deck, rails, side girders, pillars, shadow. */
export function buildViaduct(lines: number[][], shadowMaterial: THREE.Material, sunOffset: THREE.Vector2): THREE.Group {
  const group = new THREE.Group();
  group.name = 'viaduct';
  const steel = new THREE.MeshLambertMaterial({ color: '#6f8d77', side: THREE.DoubleSide });

  const deck = new THREE.Mesh(
    buildStrips(lines.map((p) => ({ p, hw: HALF_WIDTH })), DECK_TOP),
    new THREE.MeshBasicMaterial({ color: '#4f4a45' }),
  );
  const railSteel = new THREE.Mesh(
    buildStrips(lines.map((p) => ({ p, hw: 0.82 })), DECK_TOP + 0.03),
    new THREE.MeshBasicMaterial({ color: '#9c9ca0' }),
  );
  const railBed = new THREE.Mesh(
    buildStrips(lines.map((p) => ({ p, hw: 0.68 })), DECK_TOP + 0.06),
    new THREE.MeshBasicMaterial({ color: '#3b342e' }),
  );

  // Girder faces along both sides of every segment.
  const pos: number[] = [];
  const nrm: number[] = [];
  const pillars: THREE.Vector2[] = [];
  for (const p of lines) {
    let carry = PILLAR_SPACING / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i];
      const ay = p[i + 1];
      const bx = p[i + 2];
      const by = p[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      for (const side of [1, -1]) {
        const ox = nx * HALF_WIDTH * side;
        const oy = ny * HALF_WIDTH * side;
        const quad = [
          [ax + ox, ay + oy, DECK_BOTTOM],
          [bx + ox, by + oy, DECK_BOTTOM],
          [bx + ox, by + oy, DECK_TOP],
          [ax + ox, ay + oy, DECK_BOTTOM],
          [bx + ox, by + oy, DECK_TOP],
          [ax + ox, ay + oy, DECK_TOP],
        ];
        for (const v of quad) {
          pos.push(...v);
          nrm.push(nx * side, ny * side, 0);
        }
      }
      // Pillars at a steady spacing along the line.
      let d = carry;
      while (d < len) {
        pillars.push(new THREE.Vector2(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len));
        d += PILLAR_SPACING;
      }
      carry = d - len;
    }
  }
  const girderGeo = new THREE.BufferGeometry();
  girderGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  girderGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const girders = new THREE.Mesh(girderGeo, steel);

  const pillarGeo = new THREE.BoxGeometry(0.9, 0.9, DECK_BOTTOM);
  pillarGeo.translate(0, 0, DECK_BOTTOM / 2);
  const pillarMesh = new THREE.InstancedMesh(pillarGeo, steel, pillars.length);
  const m = new THREE.Matrix4();
  pillars.forEach((pt, i) => pillarMesh.setMatrixAt(i, m.makeTranslation(pt.x, pt.y, 0)));

  // Ground shadow: the deck outline shifted away from the sun.
  const shadowLines = lines.map((p) => ({
    p: p.map((v, i) => v + (i % 2 === 0 ? sunOffset.x : sunOffset.y) * DECK_TOP),
    hw: HALF_WIDTH,
  }));
  const shadow = new THREE.Mesh(buildStrips(shadowLines), shadowMaterial);

  for (const obj of [deck, railSteel, railBed, girders, pillarMesh, shadow]) {
    obj.frustumCulled = false;
    group.add(obj);
  }
  return group;
}
