// Everything that stands up in a park: handball walls, hoops and nets, play structures, swings,
// climbing domes, comfort stations, flagpoles and fences. Shapes and positions come from
// OpenStreetMap; colors from the park looks.
import * as THREE from 'three';
import { PARK_LOOKS } from '../data/parkLooks.ts';
import { ringCentroid, type Pt } from '../geo.ts';
import type { MapData } from '../mapdata.ts';
import { shadowGeometry } from './buildings.ts';
import { at, courtFrame, findCourts, type Court, type Frame } from './courts.ts';
import { canvasTexture } from './panel.ts';

const WALL_H = 4.9; // one-wall handball: 16 ft
const WALL_COLOR = '#c8c5bb';
const STEEL = '#8d9299';
const RUBBER = '#e8b923';
const FENCE_H = 1.25;
const DOG_FENCE_H = 1.8;

const toPts = (f: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
  return out;
};

/** Upright quads along a polyline, with a see-through texture (chain link or iron bars). */
function fenceMesh(line: Pt[], height: number, material: THREE.Material, closed: boolean, repeatPerMeter = 0.5): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const n = closed ? line.length : line.length - 1;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = line[i];
    const b = line[(i + 1) % line.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const u0 = run * repeatPerMeter;
    const u1 = (run + len) * repeatPerMeter;
    run += len;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const quad: Array<[number, number, number, number, number]> = [
      [a[0], a[1], 0, u0, 0],
      [b[0], b[1], 0, u1, 0],
      [b[0], b[1], height, u1, 1],
      [a[0], a[1], 0, u0, 0],
      [b[0], b[1], height, u1, 1],
      [a[0], a[1], height, u0, 1],
    ];
    for (const [x, y, z, u, v] of quad) {
      pos.push(x, y, z);
      uv.push(u, v);
      nrm.push(nx, ny, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return new THREE.Mesh(g, material);
}

function chainLinkTexture(): THREE.Texture {
  const t = canvasTexture(64, 64, (ctx) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(210,214,218,0.85)';
    ctx.lineWidth = 3;
    for (let i = -64; i < 64; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 64, 64);
      ctx.moveTo(i + 64, 0);
      ctx.lineTo(i, 64);
      ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function barsTexture(color: string): THREE.Texture {
  const t = canvasTexture(64, 32, (ctx) => {
    ctx.clearRect(0, 0, 64, 32);
    ctx.fillStyle = color;
    for (let x = 0; x < 64; x += 10) ctx.fillRect(x, 0, 4, 32);
    ctx.fillRect(0, 0, 64, 4);
    ctx.fillRect(0, 26, 64, 5);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function netTexture(): THREE.Texture {
  const t = canvasTexture(32, 32, (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.strokeStyle = 'rgba(245,245,240,0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 32; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 32);
      ctx.moveTo(0, i);
      ctx.lineTo(32, i);
      ctx.stroke();
    }
    ctx.fillStyle = '#f5f5f0';
    ctx.fillRect(0, 0, 32, 4);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function flagTexture(): THREE.Texture {
  return canvasTexture(64, 34, (ctx) => {
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#c8353c' : '#f4f4f0';
      ctx.fillRect(0, (i * 34) / 13, 64, 34 / 13 + 1);
    }
    ctx.fillStyle = '#2a3c78';
    ctx.fillRect(0, 0, 26, 18);
  });
}

/** Everything standing up in the parks, plus their ground shadows. */
export function buildParkProps(data: MapData, shadowMaterial: THREE.Material, sunOffset: THREE.Vector2): THREE.Group {
  const group = new THREE.Group();
  group.name = 'park-props';
  const wallMat = new THREE.MeshLambertMaterial({ color: WALL_COLOR });
  const steelMat = new THREE.MeshLambertMaterial({ color: STEEL });
  const boardMat = new THREE.MeshLambertMaterial({ color: '#f2f1ec' });
  const netMat = new THREE.MeshLambertMaterial({ map: netTexture(), alphaTest: 0.35, side: THREE.DoubleSide, transparent: true });
  const chainMat = new THREE.MeshLambertMaterial({ map: chainLinkTexture(), alphaTest: 0.3, side: THREE.DoubleSide, transparent: true });

  const add = (m: THREE.Object3D) => {
    m.frustumCulled = false;
    group.add(m);
  };
  const box = (w: number, d: number, h: number, x: number, y: number, z: number, yaw: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
    m.position.set(x, y, z);
    m.rotation.z = yaw;
    add(m);
    return m;
  };
  const shadow = (ring: Pt[], h: number) => add(new THREE.Mesh(shadowGeometry(ring, sunOffset.clone().multiplyScalar(h)), shadowMaterial));
  const rectRing = (cx: number, cy: number, w: number, d: number, yaw: number): Pt[] =>
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([x, y]) => [cx + x * Math.cos(yaw) - y * Math.sin(yaw), cy + x * Math.sin(yaw) + y * Math.cos(yaw)] as Pt);

  // ---- Courts: walls, hoops and nets ----------------------------------------------------------
  const courts = findCourts(data);
  for (const c of courts) {
    const f = c.frame;
    const yaw = Math.atan2(f.u[1], f.u[0]);
    if (c.look.lines === 'handball' || c.look.midWall) {
      // One wall per court, at u = 0, or one shared wall across the middle of a back-to-back pair.
      const u = c.look.midWall ? f.L / 2 : 0.25;
      const width = Math.min(f.W - 0.6, c.look.midWall ? f.W : 6.2);
      const [x, y] = at(f, u, f.W / 2);
      box(0.45, width, WALL_H, x, y, WALL_H / 2, yaw, wallMat);
      shadow(rectRing(x, y, 0.45, width, yaw), WALL_H);
    }
    if (c.look.lines === 'basketball' || c.look.lines === 'half-basketball') {
      const ends: Array<[number, 1 | -1]> = c.look.lines === 'basketball' ? [[0, 1], [f.L, -1]] : [[0, 1]];
      for (const [base, dir] of ends) {
        const [px, py] = at(f, base - dir * 0.6, f.W / 2);
        box(0.16, 0.16, 3.4, px, py, 1.7, yaw, steelMat);
        const [bx, by] = at(f, base + dir * 0.35, f.W / 2);
        box(0.12, 1.8, 1.05, bx, by, 3.15, yaw, boardMat);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.035, 6, 14), new THREE.MeshLambertMaterial({ color: '#d4622c' }));
        const [rx, ry] = at(f, base + dir * 0.75, f.W / 2);
        rim.position.set(rx, ry, 3.05);
        add(rim);
      }
    }
    if (c.look.net) {
      const h = c.look.lines === 'volleyball' ? 2.35 : 1.07;
      for (const v of [0.2, f.W - 0.2]) {
        const [x, y] = at(f, f.L / 2, v);
        box(0.1, 0.1, h + 0.15, x, y, (h + 0.15) / 2, yaw, steelMat);
      }
      const net = fenceMesh([at(f, f.L / 2, 0.2), at(f, f.L / 2, f.W - 0.2)], h, netMat, false, 1.2);
      net.position.z = c.look.lines === 'volleyball' ? 1.35 : 0;
      add(net);
    }
    if (c.look.fence) add(fenceMesh(c.ring, DOG_FENCE_H, chainMat, true));
  }

  // ---- Park equipment -------------------------------------------------------------------------
  const parks = data.areas.filter((a) => a.k === 'park' && a.id && PARK_LOOKS[a.id!]);
  const lookAt = (x: number, y: number) => {
    for (const p of parks) {
      const ring = toPts(p.r[0]);
      const xs = ring.map((q) => q[0]);
      const ys = ring.map((q) => q[1]);
      if (x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)) return PARK_LOOKS[p.id!];
    }
    return undefined;
  };
  const gridYaw = (data.gridAngle * Math.PI) / 180;

  for (const prop of data.props) {
    const look = lookAt(prop.x, prop.y);
    const play = new THREE.MeshLambertMaterial({ color: look?.playColor ?? '#2f7fc1' });
    const shape = prop.r ? toPts(prop.r) : prop.l ? toPts(prop.l) : null;
    const frame: Frame | null = shape && shape.length > 2 ? courtFrame(shape) : null;
    const yaw = frame ? Math.atan2(frame.u[1], frame.u[0]) : gridYaw;
    switch (prop.k) {
      case 'structure': {
        // A deck on posts with a pitched roof and a slide.
        const size = frame ? Math.max(2, Math.min(3.4, Math.min(frame.L, frame.W) * 0.6)) : 2.6;
        const deck = 1.5;
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const px = prop.x + ((dx * size) / 2) * Math.cos(yaw) - ((dy * size) / 2) * Math.sin(yaw);
          const py = prop.y + ((dx * size) / 2) * Math.sin(yaw) + ((dy * size) / 2) * Math.cos(yaw);
          box(0.14, 0.14, deck + 1.1, px, py, (deck + 1.1) / 2, yaw, steelMat);
        }
        box(size, size, 0.14, prop.x, prop.y, deck, yaw, play);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(size * 0.82, 0.9, 4), play);
        roof.position.set(prop.x, prop.y, deck + 1.6);
        roof.rotation.set(Math.PI / 2, 0, yaw + Math.PI / 4);
        add(roof);
        // Slide off one side.
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.75, 3.2, 0.12), new THREE.MeshLambertMaterial({ color: RUBBER }));
        const sx = prop.x + (size / 2 + 1.4) * Math.cos(yaw);
        const sy = prop.y + (size / 2 + 1.4) * Math.sin(yaw);
        slide.position.set(sx, sy, deck / 2 + 0.2);
        slide.rotation.set(Math.atan2(deck, 3), 0, yaw + Math.PI / 2);
        add(slide);
        shadow(rectRing(prop.x, prop.y, size, size, yaw), 2.2);
        break;
      }
      case 'swing': {
        const span = frame ? Math.max(2.4, Math.min(6, frame.L - 0.6)) : 3.6;
        const h = 2.4;
        for (const side of [-1, 1]) {
          for (const lean of [-1, 1]) {
            const bx = prop.x + ((side * span) / 2) * Math.cos(yaw) - lean * 0.8 * Math.sin(yaw);
            const by = prop.y + ((side * span) / 2) * Math.sin(yaw) + lean * 0.8 * Math.cos(yaw);
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h + 0.2), steelMat);
            leg.position.set((bx + prop.x + ((side * span) / 2) * Math.cos(yaw)) / 2, (by + prop.y + ((side * span) / 2) * Math.sin(yaw)) / 2, h / 2);
            leg.rotation.set(Math.atan2(0.8, h), 0, yaw + (lean > 0 ? 0 : Math.PI));
            add(leg);
          }
        }
        box(span + 0.2, 0.09, 0.09, prop.x, prop.y, h, yaw, steelMat);
        const seats = Math.max(2, Math.floor(span / 1.4));
        for (let i = 0; i < seats; i++) {
          const t = ((i + 0.5) / seats - 0.5) * span;
          const cx = prop.x + t * Math.cos(yaw);
          const cy = prop.y + t * Math.sin(yaw);
          box(0.06, 0.06, 1.5, cx, cy, h - 0.75, yaw, steelMat);
          box(0.5, 0.18, 0.07, cx, cy, h - 1.5, yaw, play);
        }
        break;
      }
      case 'climbingframe': {
        const r = frame ? Math.max(1.5, Math.min(3.5, Math.min(frame.L, frame.W) / 2)) : 2.2;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), netMat);
        dome.rotation.x = Math.PI / 2;
        dome.position.set(prop.x, prop.y, 0.05);
        add(dome);
        break;
      }
      case 'splash': {
        const r = frame ? Math.min(frame.L, frame.W) / 2 : 4;
        box(0.12, 0.12, 2, prop.x, prop.y, 1, yaw, steelMat);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), play);
        head.position.set(prop.x, prop.y, 2.1);
        add(head);
        if (!prop.r) {
          const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: '#8fc2df', depthTest: false, depthWrite: false }));
          pad.position.set(prop.x, prop.y, 0);
          pad.renderOrder = -200;
          add(pad);
        }
        break;
      }
      case 'flagpole': {
        const H = 9;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, H), new THREE.MeshLambertMaterial({ color: '#e8e9ea' }));
        pole.rotation.x = Math.PI / 2;
        pole.position.set(prop.x, prop.y, H / 2);
        add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.85), new THREE.MeshLambertMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
        flag.position.set(prop.x + 0.8 * Math.cos(gridYaw), prop.y + 0.8 * Math.sin(gridYaw), H - 0.9);
        flag.rotation.set(Math.PI / 2, 0, gridYaw);
        add(flag);
        break;
      }
      case 'sandpit':
        break; // drawn as ground
      case 'toilets': {
        // Comfort station: brick walls with a low hipped roof.
        const h = prop.h ?? 4;
        const wallsMat = new THREE.MeshLambertMaterial({ color: '#97604a' });
        const roofMat = new THREE.MeshLambertMaterial({ color: '#b5704c' });
        if (shape && prop.r) {
          const g = new THREE.ExtrudeGeometry(new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y))), { depth: h, bevelEnabled: false });
          add(new THREE.Mesh(g, wallsMat));
          const roof = new THREE.ExtrudeGeometry(new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.35, bevelEnabled: false });
          const rm = new THREE.Mesh(roof, roofMat);
          rm.position.z = h;
          rm.scale.set(1.04, 1.04, 1);
          const [cx, cy] = ringCentroid(shape);
          rm.position.x = -cx * 0.04;
          rm.position.y = -cy * 0.04;
          add(rm);
          shadow(shape, h);
        } else {
          box(6, 4.2, h, prop.x, prop.y, h / 2, gridYaw, wallsMat);
          box(6.4, 4.6, 0.35, prop.x, prop.y, h + 0.15, gridYaw, roofMat);
          shadow(rectRing(prop.x, prop.y, 6, 4.2, gridYaw), h);
        }
        break;
      }
    }
  }

  // ---- Park fences ------------------------------------------------------------------------------
  for (const p of parks) {
    const look = PARK_LOOKS[p.id!];
    const mat = new THREE.MeshLambertMaterial({ map: barsTexture(look.fence), alphaTest: 0.4, side: THREE.DoubleSide, transparent: true });
    add(fenceMesh(toPts(p.r[0]), FENCE_H, mat, true, 0.5));
  }
  return group;
}

/** Courts and play areas keep trees off them; the map hides trees near these. */
export function courtRings(data: MapData): Court[] {
  return findCourts(data);
}
