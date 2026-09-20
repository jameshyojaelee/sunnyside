// The two of us, walking the neighborhood. A pair of small figures strolls the sidewalks forever,
// starting somewhere different on every load and never leaving the Sunnyside boundary.
import * as THREE from 'three';
import { pointInRing, type Pt } from '../geo.ts';
import type { MapData } from '../mapdata.ts';
import { canvasTexture } from './panel.ts';

const SPEED = 1.25; // m/s, a relaxed walking pace
const STRIDE = 0.78; // meters per step, sets how fast the legs swing
const PAIR_GAP = 0.48; // half the distance between the two of them
// Real heights: 5'9" and 5'4". Drawn at twice that, because two specks at true scale are almost
// impossible to spot next to a six-story building; the two of them keep their proportions.
const REAL_HEIGHTS: [number, number] = [1.753, 1.626];
const FIGURE_SCALE = 2;

interface Edge {
  /** Index of the node at the far end. */
  to: number;
  len: number;
  /** How far from the road centerline the sidewalk is. */
  off: number;
}

interface Graph {
  xy: Pt[];
  edges: Edge[][];
  /** True inside the Sunnyside boundary. */
  inside(x: number, y: number): boolean;
}

/** Walkable sidewalk graph: ground-level road segments with both ends inside the boundary. */
function buildGraph(data: MapData): Graph {
  const rings = data.boundary.map((poly) => {
    const flat = poly[0];
    const ring: Pt[] = [];
    for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    return ring;
  });
  const inside = (x: number, y: number) => rings.some((r) => pointInRing(x, y, r));
  const ids = new Map<string, number>();
  const xy: Pt[] = [];
  const edges: Edge[][] = [];
  const node = (x: number, y: number) => {
    const key = `${Math.round(x * 2)}|${Math.round(y * 2)}`;
    let i = ids.get(key);
    if (i === undefined) {
      i = xy.length;
      ids.set(key, i);
      xy.push([x, y]);
      edges.push([]);
    }
    return i;
  };
  for (const r of data.roads) {
    if (r.l !== 0 || r.sw <= 0) continue; // bridges, ramps and alleys with no sidewalk
    const off = r.w / 2 + r.sw / 2;
    for (let i = 2; i < r.p.length; i += 2) {
      const ax = r.p[i - 2];
      const ay = r.p[i - 1];
      const bx = r.p[i];
      const by = r.p[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5 || !inside(ax, ay) || !inside(bx, by)) continue;
      const a = node(ax, ay);
      const b = node(bx, by);
      if (a === b) continue;
      edges[a].push({ to: b, len, off });
      edges[b].push({ to: a, len, off });
    }
  }
  return { xy, edges, inside };
}

/** Where one of us is right now: partway along an edge, out on the sidewalk. */
class Walker {
  from = 0;
  to = 0;
  s = 0;
  len = 1;
  off = 5;
  /** Meters walked in total, which drives the stride. */
  distance = 0;

  private g: Graph;

  constructor(g: Graph) {
    this.g = g;
    // Somewhere new every load.
    do {
      this.from = Math.floor(Math.random() * g.xy.length);
    } while (!g.edges[this.from].length);
    this.take(g.edges[this.from][Math.floor(Math.random() * g.edges[this.from].length)]);
    this.s = Math.random() * this.len;
  }

  private take(e: Edge) {
    this.to = e.to;
    this.len = e.len;
    this.off = e.off;
    this.s = 0;
  }

  step(dt: number) {
    this.s += SPEED * dt;
    this.distance += SPEED * dt;
    let guard = 0;
    while (this.s >= this.len && guard++ < 8) {
      this.s -= this.len;
      const here = this.to;
      const back = this.from;
      const options = this.g.edges[here];
      if (!options.length) return;
      // Keep going rather than turning around, unless this is a dead end.
      const ahead = options.filter((e) => e.to !== back);
      const pick = (ahead.length ? ahead : options)[Math.floor(Math.random() * (ahead.length || options.length))];
      this.from = here;
      this.take(pick);
    }
  }

  /** Position on the sidewalk and the direction of travel. */
  at(): { x: number; y: number; dx: number; dy: number } {
    const a = this.g.xy[this.from];
    const b = this.g.xy[this.to];
    const dx = (b[0] - a[0]) / this.len;
    const dy = (b[1] - a[1]) / this.len;
    // Walk on the right-hand sidewalk, or the other one where that would step over the boundary.
    const x = a[0] + dx * this.s;
    const y = a[1] + dy * this.s;
    const off = this.g.inside(x + dy * this.off, y - dx * this.off) ? this.off : -this.off;
    return { x: x + dy * off, y: y - dx * off, dx, dy };
  }
}

/** Eyes and a wide smile, drawn small on clear glass so the skin shows through. */
function faceTexture(): THREE.Texture {
  return canvasTexture(64, 64, (ctx) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#2a221d';
    ctx.beginPath();
    ctx.arc(23, 26, 4, 0, Math.PI * 2);
    ctx.arc(41, 26, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a221d';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(32, 34, 12, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
  });
}

interface Look {
  skin: string;
  hair: string;
  /** Shirt, or dress. */
  outfit: string;
  /** A dress tapers out at the hem instead of a straight body. */
  dress: boolean;
  /** Hair down the back of the head. */
  longHair: boolean;
  height: number;
}

interface Figure {
  group: THREE.Group;
  legs: [THREE.Object3D, THREE.Object3D];
  arms: [THREE.Object3D, THREE.Object3D];
  body: THREE.Object3D;
}

/** One little person, facing along its own +X. */
function buildFigure(look: Look, face: THREE.Texture): Figure {
  const g = new THREE.Group();
  const k = look.height / 1.68; // everything is modeled at 1.68 m and scaled from there
  const skin = new THREE.MeshLambertMaterial({ color: look.skin });
  const hair = new THREE.MeshLambertMaterial({ color: look.hair });
  const outfit = new THREE.MeshLambertMaterial({ color: look.outfit });
  const legMat = new THREE.MeshLambertMaterial({ color: look.dress ? look.skin : '#3c4a63' });

  const limb = (w: number, d: number, h: number, mat: THREE.Material, x: number, y: number, top: number) => {
    const pivot = new THREE.Object3D();
    pivot.position.set(x * k, y * k, top * k);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * k, d * k, h * k), mat);
    m.position.z = (-h / 2) * k;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  const legs: [THREE.Object3D, THREE.Object3D] = [
    limb(0.15, 0.15, 0.72, legMat, 0, -0.1, 0.78),
    limb(0.15, 0.15, 0.72, legMat, 0, 0.1, 0.78),
  ];
  const arms: [THREE.Object3D, THREE.Object3D] = [
    limb(0.11, 0.11, 0.56, skin, 0, -0.22, 1.3),
    limb(0.11, 0.11, 0.56, skin, 0, 0.22, 1.3),
  ];

  const body = new THREE.Object3D();
  g.add(body);
  const torso = look.dress
    ? new THREE.Mesh(new THREE.CylinderGeometry(0.17 * k, 0.26 * k, 0.62 * k, 10), outfit)
    : new THREE.Mesh(new THREE.BoxGeometry(0.24 * k, 0.38 * k, 0.56 * k), outfit);
  if (look.dress) torso.rotation.x = Math.PI / 2;
  torso.position.z = (look.dress ? 1.06 : 1.06) * k;
  body.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135 * k, 12, 10), skin);
  head.position.z = 1.5 * k;
  body.add(head);
  // Hair: a cap over the top, plus a fall down the back for her.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.147 * k, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
  cap.rotation.x = Math.PI / 2;
  cap.rotation.z = Math.PI / 2;
  cap.position.set(-0.01 * k, 0, 1.5 * k);
  body.add(cap);
  if (look.longHair) {
    const fall = new THREE.Mesh(new THREE.BoxGeometry(0.1 * k, 0.24 * k, 0.3 * k), hair);
    fall.position.set(-0.1 * k, 0, 1.42 * k);
    body.add(fall);
  }
  const smile = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2 * k, 0.2 * k),
    new THREE.MeshBasicMaterial({ map: face, transparent: true, alphaTest: 0.3, depthWrite: false }),
  );
  smile.position.set(0.132 * k, 0, 1.51 * k);
  smile.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  body.add(smile);
  return { group: g, legs, arms, body };
}

export interface People {
  group: THREE.Group;
  update(now: number): void;
}

/**
 * Us: two figures side by side, walking the sidewalks of Sunnyside and turning at random corners.
 * They are about 1.6 m tall, so at map scale they are two specks you have to look for.
 */
export function buildPeople(data: MapData, shadowMaterial: THREE.Material): People {
  const group = new THREE.Group();
  group.name = 'people';
  const graph = buildGraph(data);
  const face = faceTexture();
  const looks: Look[] = [
    { skin: '#f3d6ba', hair: '#151216', outfit: '#2f6f8f', dress: false, longHair: false, height: REAL_HEIGHTS[0] * FIGURE_SCALE },
    { skin: '#fce8de', hair: '#171319', outfit: '#d2566f', dress: true, longHair: true, height: REAL_HEIGHTS[1] * FIGURE_SCALE },
  ];
  const figures = looks.map((l) => buildFigure(l, face));
  const shadows = figures.map(() => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.3 * FIGURE_SCALE, 10), shadowMaterial);
    m.userData.noPick = true;
    group.add(m);
    return m;
  });
  for (const f of figures) group.add(f.group);
  for (const o of group.children) o.frustumCulled = false;

  const walker = graph.xy.length ? new Walker(graph) : null;
  let last = 0;

  const place = () => {
    if (!walker) return;
    const p = walker.at();
    const yaw = Math.atan2(p.dy, p.dx);
    // Side by side: one of them a little further from the curb.
    const rx = p.dy;
    const ry = -p.dx;
    figures.forEach((f, i) => {
      const side = i === 0 ? -PAIR_GAP : PAIR_GAP;
      const x = p.x + rx * side;
      const y = p.y + ry * side;
      f.group.position.set(x, y, 0);
      f.group.rotation.z = yaw;
      // A bouncy, happy gait: legs and arms swing, and they bob on every step.
      const phase = (walker.distance / STRIDE) * Math.PI + i * 0.6;
      const swing = Math.sin(phase) * 0.55;
      f.legs[0].rotation.y = swing;
      f.legs[1].rotation.y = -swing;
      f.arms[0].rotation.y = -swing * 0.8;
      f.arms[1].rotation.y = swing * 0.8;
      f.body.position.z = Math.abs(Math.sin(phase)) * 0.045;
      shadows[i].position.set(x, y, 0);
    });
  };
  place();

  return {
    group,
    update(now: number) {
      if (!walker) return;
      const dt = last ? Math.min(0.2, (now - last) / 1000) : 0;
      last = now;
      walker.step(dt);
      place();
    },
  };
}
