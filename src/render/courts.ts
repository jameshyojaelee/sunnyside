// Painted courts: each OSM court polygon gets a canvas texture with its surface color and white
// markings, laid out in the court's own rectangle (long axis = u).
import * as THREE from 'three';
import { PARK_LOOKS, surfaceLook, type CourtLines, type SurfaceLook } from '../data/parkLooks.ts';
import { distToRing, pointInRing, type Pt } from '../geo.ts';
import type { MapData } from '../mapdata.ts';

/** The smallest rectangle around a polygon, aligned with one of its edges. u runs along the long side. */
export interface Frame {
  origin: Pt;
  u: Pt;
  v: Pt;
  /** Length along u, width along v (L >= W). */
  L: number;
  W: number;
}

export function courtFrame(ring: Pt[]): Frame {
  let best: Frame | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const v: Pt = [-u[1], u[0]];
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of ring) {
      const pu = p[0] * u[0] + p[1] * u[1];
      const pv = p[0] * v[0] + p[1] * v[1];
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      v0 = Math.min(v0, pv);
      v1 = Math.max(v1, pv);
    }
    const f: Frame = { origin: [u[0] * u0 + v[0] * v0, u[1] * u0 + v[1] * v0], u, v, L: u1 - u0, W: v1 - v0 };
    if (!best || f.L * f.W < best.L * best.W - 1e-6) best = f;
  }
  if (!best) throw new Error('Degenerate court');
  // Make u the long axis (keeping a right-handed frame).
  if (best.W > best.L) {
    const { origin, u, v, L, W } = best;
    best = { origin: [origin[0] + u[0] * L, origin[1] + u[1] * L], u: v, v: [-u[0], -u[1]], L: W, W: L };
  }
  return best;
}

/** Turn the frame 180 degrees so u = 0 is at the other end. */
export function flipFrame(f: Frame): Frame {
  return {
    origin: [f.origin[0] + f.u[0] * f.L + f.v[0] * f.W, f.origin[1] + f.u[1] * f.L + f.v[1] * f.W],
    u: [-f.u[0], -f.u[1]],
    v: [-f.v[0], -f.v[1]],
    L: f.L,
    W: f.W,
  };
}

/** World point from court coordinates. */
export const at = (f: Frame, u: number, v: number): Pt => [f.origin[0] + f.u[0] * u + f.v[0] * v, f.origin[1] + f.u[1] * u + f.v[1] * v];

/** Looks for ordinary courts elsewhere on the map, by OSM sport. */
const SPORT_LOOKS: Record<string, SurfaceLook> = {
  basketball: { color: '#6a6d70', lines: 'basketball' },
  american_handball: { color: '#b5b3ab', lines: 'handball' },
  handball: { color: '#b5b3ab', lines: 'handball' },
  volleyball: { color: '#c9a878', lines: 'volleyball', net: true },
  tennis: { color: '#4f8a5d', lines: 'outline', net: true },
};

export interface Court {
  id: string;
  ring: Pt[];
  look: SurfaceLook;
  frame: Frame;
  /** The park it sits in, if any. */
  park?: Pt[];
}

const toPts = (f: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
  return out;
};

/** Courts and surfaces that get their own paint: hand-tuned ones first, then any court with a known sport. */
export function findCourts(data: MapData): Court[] {
  const parks = data.areas.filter((a) => a.k === 'park').map((a) => toPts(a.r[0]));
  const courts: Court[] = [];
  for (const a of data.areas) {
    if (!a.id || a.k === 'park') continue;
    const look = surfaceLook(a.id) ?? (a.k === 'pitch' && a.s ? SPORT_LOOKS[a.s.split(';')[0]] : undefined);
    if (!look) continue;
    const ring = toPts(a.r[0]);
    let frame = courtFrame(ring);
    const c = at(frame, frame.L / 2, frame.W / 2);
    const park = parks.find((p) => pointInRing(c[0], c[1], p));
    // One-ended courts (half basketball, handball) face in: u = 0 goes to the end nearest the park
    // edge, where the hoop or wall stands.
    if (park && (look.lines === 'half-basketball' || look.lines === 'handball')) {
      const near0 = distToRing(...at(frame, 0, frame.W / 2), park);
      const near1 = distToRing(...at(frame, frame.L, frame.W / 2), park);
      if (near1 < near0) frame = flipFrame(frame);
    }
    courts.push({ id: a.id, ring, look, frame, park });
  }
  // Back-to-back handball courts share their wall: turn each so its wall is on the shared end.
  const hand = courts.filter((c) => c.look.lines === 'handball');
  for (const c of hand)
    for (const o of hand) {
      if (o === c) continue;
      const d0 = distToRing(...at(c.frame, 0, c.frame.W / 2), o.ring);
      const d1 = distToRing(...at(c.frame, c.frame.L, c.frame.W / 2), o.ring);
      if (Math.min(d0, d1) < 0.8 && d1 < d0) c.frame = flipFrame(c.frame);
    }
  return courts;
}

export function isModeledPark(id: string | undefined): boolean {
  return !!id && id in PARK_LOOKS;
}

const PX = 24; // texture pixels per meter

function paint(ctx: CanvasRenderingContext2D, L: number, W: number, lines: CourtLines | undefined, accent?: string) {
  const lw = 0.1;
  ctx.strokeStyle = '#f4f3ee';
  ctx.lineWidth = lw;
  const inset = 0.4;
  const rect = (u0: number, v0: number, u1: number, v1: number, fill?: string) => {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(u0, v0, u1 - u0, v1 - v0);
    }
    ctx.strokeRect(u0, v0, u1 - u0, v1 - v0);
  };
  const line = (u0: number, v0: number, u1: number, v1: number) => {
    ctx.beginPath();
    ctx.moveTo(u0, v0);
    ctx.lineTo(u1, v1);
    ctx.stroke();
  };
  const circle = (u: number, v: number, r: number, a0 = 0, a1 = Math.PI * 2) => {
    ctx.beginPath();
    ctx.arc(u, v, r, a0, a1);
    ctx.stroke();
  };
  if (!lines) return;
  rect(inset, inset, L - inset, W - inset);
  const mid = W / 2;
  const basketEnd = (base: number, dir: 1 | -1) => {
    const keyW = Math.min(4.9, W * 0.35);
    const keyL = Math.min(5.8, L * 0.24);
    const u0 = base;
    const u1 = base + dir * keyL;
    rect(Math.min(u0, u1), mid - keyW / 2, Math.max(u0, u1), mid + keyW / 2, accent);
    circle(u1, mid, Math.min(1.8, keyW / 2));
    const hoop = base + dir * 1.6;
    // Three-point arc around the hoop, stopping short of the sidelines.
    const r = Math.min(6.75, W / 2 - inset - 0.5);
    const a = Math.PI * 0.42;
    const face = dir === 1 ? 0 : Math.PI;
    circle(hoop, mid, r, face - a, face + a);
  };
  switch (lines) {
    case 'basketball':
      line(L / 2, inset, L / 2, W - inset);
      circle(L / 2, mid, Math.min(1.8, W / 6));
      basketEnd(inset, 1);
      basketEnd(L - inset, -1);
      break;
    case 'half-basketball':
      basketEnd(inset, 1);
      break;
    case 'volleyball':
      line(L / 2, inset, L / 2, W - inset);
      line(L / 2 - Math.min(3, L / 6), inset, L / 2 - Math.min(3, L / 6), W - inset);
      line(L / 2 + Math.min(3, L / 6), inset, L / 2 + Math.min(3, L / 6), W - inset);
      break;
    case 'handball':
      // One-wall handball (wall at u = 0): short line at 16 ft and service line at 25 ft of 34 ft.
      line(inset + (L - 2 * inset) * 0.47, inset, inset + (L - 2 * inset) * 0.47, W - inset);
      line(inset + (L - 2 * inset) * 0.735, inset, inset + (L - 2 * inset) * 0.735, W - inset);
      break;
    case 'handball-pair':
      for (const dir of [-1, 1]) {
        const half = L / 2 - inset;
        line(L / 2 + dir * half * 0.47, inset, L / 2 + dir * half * 0.47, W - inset);
        line(L / 2 + dir * half * 0.735, inset, L / 2 + dir * half * 0.735, W - inset);
      }
      break;
    case 'outline':
      break;
  }
}

export function courtTexture(c: Court): THREE.CanvasTexture {
  const { L, W } = c.frame;
  const px = Math.min(PX, 2048 / Math.max(L, W));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.ceil(L * px));
  canvas.height = Math.max(4, Math.ceil(W * px));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = c.look.color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Faint wear so big flat courts aren't a single flat color.
  for (let i = 0; i < (L * W) / 3; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, px * 1.5, px * 1.5);
  }
  ctx.scale(canvas.width / L, canvas.height / W);
  paint(ctx, L, W, c.look.lines, c.look.accent);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A flat mesh of the court polygon, textured in its frame. */
export function courtGeometry(c: Court): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(c.ring.map(([x, y]) => new THREE.Vector2(x, y))));
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const { origin, u, v, L, W } = c.frame;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - origin[0];
    const dy = pos.getY(i) - origin[1];
    uv[2 * i] = (dx * u[0] + dy * u[1]) / L;
    uv[2 * i + 1] = 1 - (dx * v[0] + dy * v[1]) / W;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.deleteAttribute('normal');
  return g;
}
