import * as THREE from 'three';
import { distToSegment, projectOnSegment, type Projection } from '../geo.ts';
import type { MapData } from '../mapdata.ts';

// The Sunnyside Arch: OSM node 14181628740, spanning 46th Street just south of Queens Boulevard.
// About 25 ft (7.6 m) tall, steel tubing framing "Sunnyside" on a baby-blue sign (Wikipedia).
export const ARCH_LONLAT: [number, number] = [-73.918774, 40.742843];
const PANEL_BOTTOM = 5.0;
const PANEL_TOP = 6.5;
const PEAK = 7.6;
const FRAME = '#ece7da';

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9ed2f2';
  ctx.fillRect(0, 0, 512, 96);
  // Light bulbs along the top and bottom edges.
  ctx.fillStyle = '#fff6c8';
  for (let x = 10; x < 512; x += 20) {
    for (const y of [9, 87]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.font = '900 54px Nunito, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#1d4f86';
  ctx.strokeText('SUNNYSIDE', 256, 50);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('SUNNYSIDE', 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

export interface Arch {
  group: THREE.Group;
  /** World point above the arch for labels. */
  anchor: THREE.Vector3;
  /** Ground points of the two posts (to clear trees). */
  posts: Array<[number, number]>;
  setHighlight(on: boolean): void;
}

/** Builds the arch centered on 46th Street at the OSM position, spanning curb to curb. */
export function buildArch(data: MapData, proj: Projection): Arch {
  const [px, py] = proj.toLocal(...ARCH_LONLAT);
  // Find 46th Street's centerline under the arch to get its direction and width.
  let best = { d: Infinity, ax: 0, ay: 0, bx: 1, by: 0, w: 10, sw: 3 };
  for (const r of data.roads) {
    if (r.l !== 0 || r.n !== '46th Street') continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const d = distToSegment(px, py, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]);
      if (d < best.d) best = { d, ax: r.p[i], ay: r.p[i + 1], bx: r.p[i + 2], by: r.p[i + 3], w: r.w, sw: r.sw };
    }
  }
  const t = projectOnSegment(px, py, best.ax, best.ay, best.bx, best.by);
  const cx = best.ax + (best.bx - best.ax) * t;
  const cy = best.ay + (best.by - best.ay) * t;
  const along = new THREE.Vector3(best.bx - best.ax, best.by - best.ay, 0).normalize();
  const across = new THREE.Vector3(-along.y, along.x, 0); // span direction
  const half = best.w / 2 + 1.0; // posts stand on the sidewalks, just past the curbs

  const group = new THREE.Group();
  group.name = 'arch';
  const frameMat = new THREE.MeshLambertMaterial({ color: FRAME });
  const center = new THREE.Vector3(cx, cy, 0);
  const at = (s: number, z: number) => center.clone().addScaledVector(across, s).setZ(z);

  // Posts.
  const posts: Array<[number, number]> = [];
  for (const s of [-half, half]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, PANEL_TOP, 12), frameMat);
    post.rotation.x = Math.PI / 2; // cylinder axis to z
    const p = at(s, PANEL_TOP / 2);
    post.position.copy(p);
    group.add(post);
    posts.push([p.x, p.y]);
  }

  // Curved top tube rising to the peak height.
  const curve = new THREE.QuadraticBezierCurve3(at(-half, PANEL_TOP), at(0, 2 * PEAK - PANEL_TOP), at(half, PANEL_TOP));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.16, 8, false), frameMat));
  // Lower rail under the sign.
  const rail = new THREE.LineCurve3(at(-half, PANEL_BOTTOM - 0.1), at(half, PANEL_BOTTOM - 0.1));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(rail, 1, 0.12, 8, false), frameMat));

  // Sign faces, one per side, each reading left-to-right for someone facing it.
  const tex = signTexture();
  const signMat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#223344' });
  const w = 2 * half - 0.5;
  for (const n of [along.clone(), along.clone().negate()]) {
    const right = new THREE.Vector3().crossVectors(n.clone().negate(), new THREE.Vector3(0, 0, 1));
    const mid = center.clone().addScaledVector(n, 0.12).setZ((PANEL_BOTTOM + PANEL_TOP) / 2);
    const hw = right.clone().multiplyScalar(w / 2);
    const hh = new THREE.Vector3(0, 0, (PANEL_TOP - PANEL_BOTTOM) / 2);
    const bl = mid.clone().sub(hw).sub(hh);
    const br = mid.clone().add(hw).sub(hh);
    const tr = mid.clone().add(hw).add(hh);
    const tl = mid.clone().sub(hw).add(hh);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([bl, br, tr, bl, tr, tl].flatMap((v) => [v.x, v.y, v.z]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(6).fill([n.x, n.y, n.z]).flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    group.add(new THREE.Mesh(g, signMat));
  }
  // Thin edge between the two faces so the sign has some body from oblique angles.
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, PANEL_TOP - PANEL_BOTTOM), frameMat);
  edge.position.copy(center).setZ((PANEL_BOTTOM + PANEL_TOP) / 2);
  edge.rotation.z = Math.atan2(across.y, across.x);
  edge.scale.set(1, 0.95, 0.98);
  group.add(edge);

  return {
    group,
    anchor: center.clone().setZ(PEAK + 1),
    posts,
    setHighlight(on) {
      frameMat.emissive.set(on ? '#3a3a14' : '#000000');
      signMat.emissive.set(on ? '#445566' : '#223344');
    },
  };
}
