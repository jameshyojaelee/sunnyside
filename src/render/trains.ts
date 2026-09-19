import * as THREE from 'three';
import { rng } from '../geo.ts';
import { VIADUCT_DECK_TOP } from './viaduct.ts';

const CARS = 11; // a real 7 train is 11 cars long
const CAR_LEN = 15.5;
const PITCH = CAR_LEN + 0.9;
const TRAIN_LEN = CARS * PITCH;
const SPEED = 12; // m/s
const PURPLE = '#b933ad'; // the 7 line's color

interface Track {
  pts: Float64Array; // flat x, y
  cum: Float64Array; // cumulative length at each point
  length: number;
  /** +1: trains run from the first point to the last. */
  dir: 1 | -1;
  /** Seconds between trains. */
  headway: [number, number];
}

interface Train {
  track: Track;
  /** Distance the front has traveled along the track (can exceed length while leaving). */
  s: number;
  /** Seconds until the next departure when idle. */
  wait: number;
  running: boolean;
}

function carTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  // Side (top half of the atlas): brushed stainless steel, window band, purple stripe, doors.
  const steel = ctx.createLinearGradient(0, 0, 0, 32);
  steel.addColorStop(0, '#e2e5ea');
  steel.addColorStop(1, '#a9aeb6');
  ctx.fillStyle = steel;
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = '#2a323d';
  for (let x = 6; x < 250; x += 24) ctx.fillRect(x, 6, 18, 9);
  ctx.fillStyle = PURPLE;
  ctx.fillRect(0, 18, 256, 3);
  ctx.fillStyle = 'rgba(40,46,56,0.55)';
  for (const x of [40, 118, 196]) ctx.fillRect(x, 5, 16, 25);
  // End (bottom-left): steel with a front window and a purple bullet.
  ctx.fillStyle = '#c3c7ce';
  ctx.fillRect(0, 32, 64, 32);
  ctx.fillStyle = '#2a323d';
  ctx.fillRect(12, 37, 40, 11);
  ctx.fillStyle = PURPLE;
  ctx.beginPath();
  ctx.arc(32, 55, 5, 0, Math.PI * 2);
  ctx.fill();
  // Roof (bottom-right).
  ctx.fillStyle = '#8b9098';
  ctx.fillRect(64, 32, 192, 32);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Car body with UVs pointing into the atlas: sides, ends, roof. Length along +x. */
function carGeometry(): THREE.BufferGeometry {
  const L = CAR_LEN / 2;
  const W = 1.45;
  const H = 3.5;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const quad = (c: number[][], n: number[], u0: number, v0: number, u1: number, v1: number) => {
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...c[k]);
      nrm.push(...n);
      uv.push(...uvs[k]);
    }
  };
  // Atlas regions (v = 1 is the top of the canvas).
  const side = [0, 0.5, 1, 1];
  const end = [0, 0, 0.25, 0.5];
  const roof = [0.25, 0, 1, 0.5];
  quad([[-L, -W, 0], [L, -W, 0], [L, -W, H], [-L, -W, H]], [0, -1, 0], side[0], side[1], side[2], side[3]);
  quad([[L, W, 0], [-L, W, 0], [-L, W, H], [L, W, H]], [0, 1, 0], side[0], side[1], side[2], side[3]);
  quad([[L, -W, 0], [L, W, 0], [L, W, H], [L, -W, H]], [1, 0, 0], end[0], end[1], end[2], end[3]);
  quad([[-L, W, 0], [-L, -W, 0], [-L, -W, H], [-L, W, H]], [-1, 0, 0], end[0], end[1], end[2], end[3]);
  quad([[-L, -W, H], [L, -W, H], [L, W, H], [-L, W, H]], [0, 0, 1], roof[0], roof[1], roof[2], roof[3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function makeTrack(flat: number[], dir: 1 | -1, headway: [number, number]): Track {
  const pts = Float64Array.from(flat);
  const n = pts.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  return { pts, cum, length: cum[n - 1], dir, headway };
}

/** Point at distance d along the direction of travel. */
function pointAt(t: Track, d: number, out: THREE.Vector2): THREE.Vector2 {
  const s = t.dir === 1 ? d : t.length - d;
  const clamped = Math.min(t.length, Math.max(0, s));
  let lo = 0;
  let hi = t.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t.cum[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const seg = t.cum[hi] - t.cum[lo] || 1;
  const k = (clamped - t.cum[lo]) / seg;
  return out.set(t.pts[2 * lo] + (t.pts[2 * hi] - t.pts[2 * lo]) * k, t.pts[2 * lo + 1] + (t.pts[2 * hi + 1] - t.pts[2 * lo + 1]) * k);
}

/**
 * 7 trains on the elevated tracks. Tracks are sorted across the structure: the outer two are local
 * (trains keep right, as in NYC), the middle one is express.
 */
export function buildTrains(viaduct: number[][], reducedMotion: boolean) {
  const long = viaduct.filter((v) => v.length >= 8).map((v) => makeTrack(v, 1, [0, 0])).filter((t) => t.length > 400);
  const group = new THREE.Group();
  group.name = 'trains';
  if (!long.length) return { group, update(_now: number) {} };

  // Order tracks from left to right across the main direction of the line.
  const ref = long[0];
  const ax = ref.pts[ref.pts.length - 2] - ref.pts[0];
  const ay = ref.pts[ref.pts.length - 1] - ref.pts[1];
  const alen = Math.hypot(ax, ay);
  const [ux, uy] = [ax / alen, ay / alen];
  const side = (t: Track) => {
    let s = 0;
    for (let i = 0; i < t.pts.length; i += 2) s += -(t.pts[i] - ref.pts[0]) * uy + (t.pts[i + 1] - ref.pts[1]) * ux;
    return s / (t.pts.length / 2);
  };
  long.sort((a, b) => side(b) - side(a)); // leftmost (relative to ref direction) first
  const rand = rng(77);
  const tracks = long.map((t, i) => {
    const forward = (t.pts[t.pts.length - 2] - t.pts[0]) * ux + (t.pts[t.pts.length - 1] - t.pts[1]) * uy > 0;
    const middle = long.length === 3 && i === 1;
    // Keep right: on the right-hand track (last in the sorted list) trains move along ref; on the left one, against it.
    const alongRef = middle ? rand() < 0.5 : i === long.length - 1;
    t.dir = alongRef === forward ? 1 : -1;
    t.headway = middle ? [45, 90] : [18, 40];
    return t;
  });

  const trains: Train[] = tracks.map((track, i) => ({
    track,
    // Start the local trains mid-line so there is something to see right away.
    s: i === 1 && tracks.length === 3 ? 0 : track.length * (0.35 + 0.25 * i),
    wait: 20,
    running: !(i === 1 && tracks.length === 3),
  }));

  const mesh = new THREE.InstancedMesh(carGeometry(), new THREE.MeshLambertMaterial({ map: carTexture(), emissive: '#3a3d42' }), trains.length * CARS);
  mesh.frustumCulled = false;
  group.add(mesh);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const front = new THREE.Vector2();
  const back = new THREE.Vector2();
  let last = 0;

  const place = () => {
    trains.forEach((tr, ti) => {
      for (let c = 0; c < CARS; c++) {
        const f = tr.s - c * PITCH;
        const b = f - CAR_LEN;
        const idx = ti * CARS + c;
        if (!tr.running || f <= 0 || b >= tr.track.length) {
          mesh.setMatrixAt(idx, hidden);
          continue;
        }
        pointAt(tr.track, f, front);
        pointAt(tr.track, b, back);
        pos.set((front.x + back.x) / 2, (front.y + back.y) / 2, VIADUCT_DECK_TOP + 0.15);
        q.setFromAxisAngle(zAxis, Math.atan2(front.y - back.y, front.x - back.x));
        mesh.setMatrixAt(idx, m.compose(pos, q, one));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place();

  return {
    group,
    update(now: number) {
      if (reducedMotion) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      for (const tr of trains) {
        if (tr.running) {
          tr.s += SPEED * dt;
          if (tr.s - TRAIN_LEN > tr.track.length) {
            tr.running = false;
            tr.wait = tr.track.headway[0] + rand() * (tr.track.headway[1] - tr.track.headway[0]);
          }
        } else if ((tr.wait -= dt) <= 0) {
          tr.running = true;
          tr.s = 0;
        }
      }
      place();
    },
  };
}
