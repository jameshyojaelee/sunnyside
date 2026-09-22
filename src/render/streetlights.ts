// Streetlights along every sidewalk: plain posts by day, warm pools of light after dark.
import * as THREE from 'three';
import { pointInRing, rng, type Pt } from '../geo.ts';
import type { MapData } from '../mapdata.ts';
import { NIGHT } from './shaders.ts';

const SPACING = 30; // meters between lamps on one side of a street
const POST_H = 5.2;
const ARM = 1.1; // how far the head reaches out over the roadway
const POOL_R = 7.5; // radius of the light on the ground
const GLOW_R = 2.4; // radius of the halo around the head
const TREE_CLEAR = 3.5; // don't plant a lamp inside a street tree

export interface Streetlights {
  group: THREE.Group;
  count: number;
}

export interface Lamp {
  /** Base of the post. */
  x: number;
  y: number;
  /** Direction the arm reaches (toward the roadway). */
  ax: number;
  ay: number;
}

export function lampPositions(data: MapData): Lamp[] {
  const rings = data.boundary.map((poly) => {
    const flat = poly[0];
    const ring: Pt[] = [];
    for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    return ring;
  });
  const inside = (x: number, y: number) => rings.some((r) => pointInRing(x, y, r));
  // Street trees, on a coarse grid, so a lamp never grows out of a canopy.
  const treeCells = new Map<string, number[]>();
  for (let i = 0; i < data.trees.length; i += 4) {
    const key = `${Math.floor(data.trees[i] / 10)}|${Math.floor(data.trees[i + 1] / 10)}`;
    const cell = treeCells.get(key);
    if (cell) cell.push(data.trees[i], data.trees[i + 1]);
    else treeCells.set(key, [data.trees[i], data.trees[i + 1]]);
  }
  const nearTree = (x: number, y: number) => {
    const cx = Math.floor(x / 10);
    const cy = Math.floor(y / 10);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++) {
        const cell = treeCells.get(`${i}|${j}`);
        if (!cell) continue;
        for (let k = 0; k < cell.length; k += 2) if (Math.hypot(cell[k] - x, cell[k + 1] - y) < TREE_CLEAR) return true;
      }
    return false;
  };

  const lamps: Lamp[] = [];
  const rand = rng(90210);
  for (const r of data.roads) {
    if (r.l !== 0 || r.sw <= 0) continue; // bridges and alleys get none
    const off = r.w / 2 + 0.9; // just behind the curb
    // Stagger the two sides, the way a real street alternates them.
    for (const side of [1, -1] as const) {
      let carry = side > 0 ? rand() * SPACING : SPACING / 2 + rand() * 4;
      for (let i = 2; i < r.p.length; i += 2) {
        const ax = r.p[i - 2];
        const ay = r.p[i - 1];
        const bx = r.p[i];
        const by = r.p[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 0.5) continue;
        const dx = (bx - ax) / len;
        const dy = (by - ay) / len;
        for (let s = carry; s < len; s += SPACING) {
          const x = ax + dx * s + dy * off * side;
          const y = ay + dy * s - dx * off * side;
          if (!inside(x, y) || nearTree(x, y)) continue;
          lamps.push({ x, y, ax: -dy * side, ay: dx * side });
        }
        carry = ((carry - len) % SPACING + SPACING) % SPACING;
      }
    }
  }
  return lamps;
}

/** Soft round falloff, used for both the ground pool and the halo. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,236,190,1)');
  g.addColorStop(0.35, 'rgba(255,220,150,0.45)');
  g.addColorStop(1, 'rgba(255,205,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** One instanced quad per lamp, lying on the ground or facing the camera, lit only at night. */
function glowMesh(lamps: Lamp[], radius: number, height: number, flat: boolean, uRight: { value: THREE.Vector2 }, strength: number) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const at = new Float32Array(lamps.length * 2);
  lamps.forEach((l, i) => {
    // Both the pool and the halo sit under the lamp head, out at the end of the arm.
    at[2 * i] = l.x + l.ax * ARM;
    at[2 * i + 1] = l.y + l.ay * ARM;
  });
  geo.setAttribute('aLamp', new THREE.InstancedBufferAttribute(at, 2));
  geo.instanceCount = lamps.length;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: glowTexture() }, uRight, uNight: NIGHT, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      attribute vec2 aLamp;
      uniform vec2 uRight;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 wp = ${
          flat
            ? `vec3(aLamp + position.xy * ${radius.toFixed(2)}, 0.06)`
            : `vec3(aLamp + uRight * position.x * ${radius.toFixed(2)}, ${height.toFixed(2)} + position.y * ${radius.toFixed(2)})`
        };
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uNight;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uTex, vUv);
        float a = c.a * uNight * uStrength;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c.rgb * a, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.userData.noPick = true;
  return m;
}

/**
 * Lamp posts along every sidewalk. The posts are always there; the light pools and halos fade in
 * with NIGHT, so flipping to night lights the whole neighborhood up at once.
 */
export function buildStreetlights(data: MapData, uRight: { value: THREE.Vector2 }): Streetlights {
  const group = new THREE.Group();
  group.name = 'streetlights';
  const lamps = lampPositions(data);

  // Post and head as one instanced object: a slim column, an arm over the street, and the lamp.
  const post = new THREE.CylinderGeometry(0.08, 0.13, POST_H, 6);
  post.rotateX(Math.PI / 2);
  post.translate(0, 0, POST_H / 2);
  const arm = new THREE.BoxGeometry(ARM, 0.09, 0.09);
  arm.translate(ARM / 2, 0, POST_H - 0.12);
  const head = new THREE.BoxGeometry(0.62, 0.3, 0.16);
  head.translate(ARM, 0, POST_H - 0.26);
  const body = new THREE.InstancedMesh(mergeGeometries([post, arm, head]), new THREE.MeshLambertMaterial({ color: '#3c4148' }), lamps.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  lamps.forEach((l, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(l.ay, l.ax));
    m.compose(new THREE.Vector3(l.x, l.y, 0), q, one);
    body.setMatrixAt(i, m);
  });
  body.frustumCulled = false;
  body.userData.noPick = true;
  group.add(body);

  // The light itself: a pool on the ground, then a halo around the head.
  const pool = glowMesh(lamps, POOL_R, 0, true, uRight, 0.75);
  pool.renderOrder = 4;
  group.add(pool);
  group.add(glowMesh(lamps, GLOW_R, POST_H - 0.26, false, uRight, 0.9));
  return { group, count: lamps.length };
}

/** Merge a few small geometries into one (no indices, positions and normals only). */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const g of geos) {
    const nonIndexed = g.index ? g.toNonIndexed() : g;
    const p = nonIndexed.getAttribute('position');
    const n = nonIndexed.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}
