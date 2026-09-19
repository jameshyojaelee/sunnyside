import * as THREE from 'three';
import { distToSegment, projectOnSegment, type Projection } from '../geo.ts';
import type { MapData } from '../mapdata.ts';
import { twoSidedPanel } from './panel.ts';

// The Sunnyside Arch: OSM node 14181628740, spanning 46th Street just south of Queens Boulevard.
// Shape follows photos on Wikimedia Commons (2007, 2019, 2021): two silver posts joined by two
// beams, an arched blue "SUNNYSIDE" banner, and an Art Deco crown of five stepped, rounded ladder
// loops (neon at night: green outside, red, then white in the middle).
export const ARCH_LONLAT: [number, number] = [-73.918774, 40.742843];
const H = 11.5; // overall height; photos put it at about 1.6x the post spacing
const S = 7.2; // post spacing
const Z_UPPER = 0.6 * H; // upper beam
const Z_LOWER = 0.4 * H; // lower beam
const SILVER = '#dde1e6';

/** Crown loops: center x and outer half-width in units of S, top in units of H, neon color. */
const FINS = [
  { x: 0, a: 0.125, top: 1.0, neon: '#cdeeff', outerDown: Z_UPPER },
  { x: -0.19, a: 0.067, top: 0.872, neon: '#ff5a4f', outerDown: Z_UPPER },
  { x: 0.19, a: 0.067, top: 0.872, neon: '#ff5a4f', outerDown: Z_UPPER },
  { x: -0.295, a: 0.045, top: 0.741, neon: '#3ddc84', outerDown: Z_LOWER },
  { x: 0.295, a: 0.045, top: 0.741, neon: '#3ddc84', outerDown: Z_LOWER },
];

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** Arched blue banner with white letters following the curve; transparent outside the band. */
function bannerTexture() {
  return canvasTex(512, 212, (ctx) => {
    const cx = 256;
    const cy = 600;
    const r1 = 570;
    const r2 = 470;
    const half = Math.asin(236 / r1);
    const band = () => {
      ctx.beginPath();
      ctx.arc(cx, cy, r1, -Math.PI / 2 - half, -Math.PI / 2 + half);
      ctx.arc(cx, cy, r2, -Math.PI / 2 + half, -Math.PI / 2 - half, true);
      ctx.closePath();
    };
    band();
    const g = ctx.createLinearGradient(0, 30, 0, 180);
    g.addColorStop(0, '#5b8fe0');
    g.addColorStop(1, '#2f5cae');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#f4f7fb';
    ctx.stroke();
    const text = 'SUNNYSIDE';
    ctx.font = '900 70px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rm = (r1 + r2) / 2;
    const spread = half * 0.8;
    [...text].forEach((ch, i) => {
      const ang = -spread + (2 * spread * i) / (text.length - 1);
      ctx.save();
      ctx.translate(cx + Math.sin(ang) * rm, cy - Math.cos(ang) * rm);
      ctx.rotate(ang);
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#173a78';
      ctx.strokeText(ch, 0, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
  });
}

/** Ladder truss: two rails with rungs, transparent between them. Repeats along the loop. */
function ladderTexture() {
  const t = canvasTex(32, 32, (ctx) => {
    ctx.fillStyle = SILVER;
    ctx.fillRect(0, 0, 32, 7);
    ctx.fillRect(0, 25, 32, 7);
    ctx.fillRect(12, 0, 7, 32);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 6, 32, 1);
    ctx.fillRect(0, 31, 32, 1);
  });
  t.wrapS = THREE.RepeatWrapping;
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

/** Builds the arch centered on 46th Street at the OSM position, facing along the street. */
export function buildArch(data: MapData, proj: Projection): Arch {
  const [px, py] = proj.toLocal(...ARCH_LONLAT);
  // 46th Street's centerline under the arch gives its direction.
  let best = { d: Infinity, ax: 0, ay: 0, bx: 1, by: 0 };
  for (const r of data.roads) {
    if (r.l !== 0 || r.n !== '46th Street') continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const d = distToSegment(px, py, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]);
      if (d < best.d) best = { d, ax: r.p[i], ay: r.p[i + 1], bx: r.p[i + 2], by: r.p[i + 3] };
    }
  }
  const t = projectOnSegment(px, py, best.ax, best.ay, best.bx, best.by);
  const center = new THREE.Vector3(best.ax + (best.bx - best.ax) * t, best.ay + (best.by - best.ay) * t, 0);
  const along = new THREE.Vector3(best.bx - best.ax, best.by - best.ay, 0).normalize();
  const across = new THREE.Vector3(-along.y, along.x, 0);
  /** World point from arch-plane coordinates (x across the street, z up, y along it). */
  const P = (x: number, z: number, y = 0) => center.clone().addScaledVector(across, x).addScaledVector(along, y).setZ(z);
  const yaw = Math.atan2(across.y, across.x);

  const group = new THREE.Group();
  group.name = 'arch';
  // Slight self-light so the steel reads as silver even on the shaded side.
  const frame = new THREE.MeshLambertMaterial({ color: SILVER, emissive: '#44484e' });
  const box = (x0: number, x1: number, z0: number, z1: number, depth: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, depth, z1 - z0), frame);
    m.position.copy(P((x0 + x1) / 2, (z0 + z1) / 2));
    m.rotation.z = yaw;
    group.add(m);
  };

  // Posts, the upper beam (reaching past the posts), and the lower beam.
  const posts: Array<[number, number]> = [];
  for (const sx of [-S / 2, S / 2]) {
    box(sx - 0.17, sx + 0.17, 0, Z_UPPER + 0.35, 0.34);
    const base = P(sx, 0);
    posts.push([base.x, base.y]);
  }
  box(-S / 2 - 0.14 * S, S / 2 + 0.14 * S, Z_UPPER - 0.14, Z_UPPER + 0.14, 0.26);
  box(-S / 2, S / 2, Z_LOWER - 0.12, Z_LOWER + 0.12, 0.26);

  // Small arch under the banner, springing from the lower beam.
  const under = new THREE.QuadraticBezierCurve3(P(-0.27 * S, Z_LOWER), P(0, Z_LOWER + 0.15 * H), P(0.27 * S, Z_LOWER));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(under, 24, 0.11, 8, false), frame));

  // Crown: stepped ladder loops with a neon line along each outer edge.
  const ladder = new THREE.MeshLambertMaterial({ map: ladderTexture(), alphaTest: 0.5, side: THREE.DoubleSide, emissive: '#44484e' });
  const band = 0.042 * S;
  for (const f of FINS) {
    const cx = f.x * S;
    const r = f.a * S - band / 2; // centerline radius of the loop
    const top = f.top * H - band / 2;
    const outerIsLeft = f.x < 0;
    const leftDown = outerIsLeft ? f.outerDown : Z_UPPER;
    const rightDown = outerIsLeft ? Z_UPPER : f.outerDown;
    // Path: up the left leg, over the round top, down the right leg.
    const path: THREE.Vector2[] = [new THREE.Vector2(cx - r, leftDown)];
    for (let i = 0; i <= 20; i++) {
      const ang = Math.PI - (i / 20) * Math.PI;
      path.push(new THREE.Vector2(cx + Math.cos(ang) * r, top - r + Math.sin(ang) * r));
    }
    path.push(new THREE.Vector2(cx + r, rightDown));
    group.add(ribbon(path, band, 0, ladder, P, 0.24));
    const neon = new THREE.MeshBasicMaterial({ color: f.neon, side: THREE.DoubleSide });
    group.add(ribbon(path, 0.07, band / 2 + 0.035, neon, P, 1));
  }

  // The banner, readable from both directions.
  const signMat = new THREE.MeshLambertMaterial({ map: bannerTexture(), alphaTest: 0.5, emissive: '#1c2a44' });
  const bw = 0.62 * S;
  const bh = (bw * 212) / 512;
  group.add(twoSidedPanel(P(0, Z_LOWER + 0.02 * H + bh / 2), along, bw, bh, 0.12, signMat));

  for (const m of group.children) m.frustumCulled = false;
  return {
    group,
    anchor: P(0, H + 1),
    posts,
    setHighlight(on) {
      frame.emissive.set(on ? '#6a6a30' : '#44484e');
      ladder.emissive.set(on ? '#6a6a30' : '#44484e');
      signMat.emissive.set(on ? '#3d4f70' : '#1c2a44');
    },
  };
}

/** Flat band of width w following a path in the arch plane, shifted sideways by `offset`. */
function ribbon(
  path: THREE.Vector2[],
  w: number,
  offset: number,
  material: THREE.Material,
  P: (x: number, z: number) => THREE.Vector3,
  repeat: number,
): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let s = 0;
  path.forEach((p, i) => {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const d = new THREE.Vector2().subVectors(next, prev).normalize();
    // Outward side of a loop traversed up-left, over, down-right is to the left of travel.
    const n = new THREE.Vector2(-d.y, d.x);
    if (i > 0) s += p.distanceTo(prev);
    for (const side of [-1, 1]) {
      const q = p.clone().addScaledVector(n, offset + (side * w) / 2);
      const v = P(q.x, q.y);
      pos.push(v.x, v.y, v.z);
      uv.push(s / repeat, side < 0 ? 0 : 1);
    }
    if (i > 0) {
      const b = i * 2;
      idx.push(b - 2, b - 1, b + 1, b - 2, b + 1, b);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}
