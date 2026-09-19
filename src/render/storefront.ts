import * as THREE from 'three';
import { distToSegment, nearestOnLine, pointInRing, type Pt } from '../geo.ts';
import type { PlaceFacade } from '../places.ts';
import { canvasTexture, fitFont } from './panel.ts';
import { geometry, pushQuad, UNIT } from './quads.ts';

// Custom storefronts modeled on real buildings (see PlaceFacade): shop glass along the street,
// canopy, cornice, a lettered sign panel, big wall lettering, corner signs and door posts.

export interface FacadeFront {
  facade: PlaceFacade;
  edge: number;
  /** Where along the wall (0-1) the shop is centered. */
  t: number;
  storefront: Pt;
}

const cache = new Map<string, THREE.Texture>();
const cached = (key: string, make: () => THREE.Texture) => cache.get(key) ?? cache.set(key, make()).get(key)!;

/** Wall tile for 3 m x 3.2 m: smooth panels with faint seams, or stone blocks. */
export function facadeWallTexture(color: string, finish: 'smooth' | 'stone'): THREE.Texture {
  return cached(`wall:${color}:${finish}`, () => {
    const t = canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      if (finish === 'smooth') {
        ctx.fillRect(0, 0, 1, 64);
        ctx.fillRect(0, 0, 64, 1);
      } else {
        for (let row = 0; row < 8; row++) {
          ctx.fillRect(0, row * 8, 64, 1);
          for (let x = row % 2 ? 8 : 0; x < 64; x += 16) ctx.fillRect(x, row * 8, 1, 8);
        }
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

function glassTexture(): THREE.Texture {
  return cached('glass', () => {
    const t = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, '#6b86ad');
      g.addColorStop(1, '#223048');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#2b2e33';
      ctx.fillRect(0, 0, 3, 64);
      ctx.fillRect(0, 0, 64, 3);
      ctx.fillRect(0, 14, 64, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(10, 20, 4, 40);
    });
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

function panelTexture(color: string, text: string | undefined, textColor: string, w: number, h: number, tile: boolean): THREE.Texture {
  const W = 512;
  const H = Math.max(16, Math.round((W * h) / w));
  return cached(`panel:${color}:${text}:${textColor}:${W}x${H}:${tile}`, () =>
    canvasTexture(W, H, (ctx) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
      if (tile) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        const step = Math.max(8, H / 6);
        for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, 1);
        for (let x = 0; x < W; x += step) ctx.fillRect(x, 0, 1, H);
      }
      if (text) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitFont(ctx, text, W * 0.86, H * 0.72);
        ctx.fillStyle = textColor;
        ctx.fillText(text, W / 2, H / 2 + H * 0.03);
      }
    }),
  );
}

/** Plain lettering on a transparent background (drawn straight onto the wall). */
function lettersTexture(text: string, color: string, w: number, h: number): THREE.Texture {
  const W = 1024;
  const H = Math.max(32, Math.round((W * h) / w));
  return cached(`letters:${text}:${color}:${W}x${H}`, () =>
    canvasTexture(W, H, (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = fitFont(ctx, text, W * 0.96, H * 0.9);
      ctx.lineWidth = Math.max(3, size / 14);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeText(text, W / 2, H / 2 + 3);
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, H / 2);
    }),
  );
}

function cornerTexture(lines: string[], color: string, bg: string): THREE.Texture {
  return cached(`corner:${lines.join('|')}:${color}:${bg}`, () =>
    canvasTexture(128, 144, (ctx) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 128, 144);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lh = 144 / lines.length;
      lines.forEach((l, i) => {
        fitFont(ctx, l, 110, lh * 0.8);
        ctx.fillText(l, 64, lh * (i + 0.5) + 3);
      });
    }),
  );
}

/** Which walls face one of the given lot outlines (their outside, a few meters out, is in the lot). */
export function lotWalls(ring: Pt[], lots: Pt[][]): boolean[] {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 3) return false;
    const x = (a[0] + b[0]) / 2 + ((b[1] - a[1]) / len) * 3;
    const y = (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len) * 3;
    return lots.some((l) => pointInRing(x, y, l));
  });
}

/** Which walls face a street (their outside, a few meters out, is on or next to a road). */
export function streetWalls(ring: Pt[], roads: Array<{ w: number; sw?: number; p: number[] }>): boolean[] {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 3) return false;
    const x = (a[0] + b[0]) / 2 + ((b[1] - a[1]) / len) * 3;
    const y = (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len) * 3;
    return roads.some((r) => {
      for (let k = 0; k + 3 < r.p.length; k += 2)
        if (distToSegment(x, y, r.p[k], r.p[k + 1], r.p[k + 2], r.p[k + 3]) - r.w / 2 - (r.sw ?? 0) < 3) return true;
      return false;
    });
  });
}

/**
 * Adds a custom storefront to a building group. `building` holds the building-wide parts (wall
 * finish is applied by the caller); each front adds that shop's band, lettering, posts and corner signs.
 */
export function buildStorefront(
  g: THREE.Group,
  ring: Pt[],
  h: number,
  building: PlaceFacade,
  fronts: FacadeFront[],
  roads: Array<{ w: number; sw?: number; p: number[] }>,
  lots: Pt[][] = [],
): void {
  // Shop fronts face the building's own parking lot if it has one, otherwise the street.
  const onStreet = lots.length ? lotWalls(ring, lots) : streetWalls(ring, roads);
  const wall = (edge: number) => {
    const a = ring[edge];
    const b = ring[(edge + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = new THREE.Vector3((b[1] - a[1]) / len, -(b[0] - a[0]) / len, 0);
    const at = (t: number, out: number, z: number) => new THREE.Vector3(a[0] + (b[0] - a[0]) * t + n.x * out, a[1] + (b[1] - a[1]) * t + n.y * out, z);
    return { len, n, at };
  };
  /** Flat quad on wall `edge` between t0..t1 and z0..z1, `out` meters in front of it. */
  const quad = (edge: number, t0: number, t1: number, z0: number, z1: number, out: number, mat: THREE.Material, uRepeat = 1) => {
    const { n, at } = wall(edge);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const uvs = uRepeat === 1 ? UNIT : [[0, 0], [uRepeat, 0], [uRepeat, 1], [0, 1]];
    pushQuad(pos, nrm, uv, [at(t0, out, z0), at(t1, out, z0), at(t1, out, z1), at(t0, out, z1)], n, uvs);
    g.add(new THREE.Mesh(geometry(pos, nrm, uv), mat));
  };

  const glassTop = building.shopGlass ?? Math.min(3.2, h - 1.5);
  const bandBottom = glassTop + (building.canopy ? 0.75 : 0.05);

  // Shop windows and canopy along every street-facing wall.
  ring.forEach((_, edge) => {
    if (!onStreet[edge]) return;
    const { len, n, at } = wall(edge);
    const inset = Math.min(0.3, len * 0.05) / len;
    if (building.shopGlass) quad(edge, inset, 1 - inset, 0.25, glassTop, 0.04, new THREE.MeshLambertMaterial({ map: glassTexture() }), len / 3);
    if (building.canopy) {
      const mat = new THREE.MeshLambertMaterial({ color: building.canopy, side: THREE.DoubleSide });
      const pos: number[] = [];
      const nrm: number[] = [];
      const uv: number[] = [];
      const top = glassTop + 0.55;
      const slopeN = new THREE.Vector3(n.x * 0.3, n.y * 0.3, 0.9).normalize();
      pushQuad(pos, nrm, uv, [at(0, 0.02, top), at(1, 0.02, top), at(1, 0.9, top - 0.3), at(0, 0.9, top - 0.3)], slopeN, UNIT);
      pushQuad(pos, nrm, uv, [at(0, 0.9, top - 0.6), at(1, 0.9, top - 0.6), at(1, 0.9, top - 0.3), at(0, 0.9, top - 0.3)], n, UNIT);
      g.add(new THREE.Mesh(geometry(pos, nrm, uv), mat));
    }
  });

  // Molding under the roofline on every wall.
  if (building.cornice && h > 3.5) {
    const mat = new THREE.MeshLambertMaterial({ color: building.cornice });
    ring.forEach((_, edge) => quad(edge, 0, 1, h - 0.9, h - 0.35, 0.05, mat));
  }

  for (const front of fronts) {
    const f = front.facade;
    const { len } = wall(front.edge);
    const span = (width: number) => {
      const half = Math.min(width, len - 0.6) / 2 / len;
      const c = Math.min(1 - half - 0.3 / len, Math.max(half + 0.3 / len, front.t));
      return [c - half, c + half] as const;
    };

    if (f.gable) {
      // Raised wall section over the entrance: straight sides, then an arched top.
      const { n, at } = wall(front.edge);
      const gw = Math.min(f.gable.width, len - 0.6);
      const [t0, t1] = span(gw);
      const base = h - 0.4;
      const shoulder = h + f.gable.rise * 0.45;
      const top = h + f.gable.rise;
      const outline: THREE.Vector2[] = [new THREE.Vector2(0, base), new THREE.Vector2(gw, base), new THREE.Vector2(gw, shoulder)];
      for (let i = 1; i < 16; i++) {
        const a = (i / 16) * Math.PI;
        outline.push(new THREE.Vector2(gw / 2 + (Math.cos(a) * gw) / 2, shoulder + Math.sin(a) * (top - shoulder)));
      }
      outline.push(new THREE.Vector2(0, shoulder));
      const world = (p: THREE.Vector2) => at(t0 + (p.x / gw) * (t1 - t0), 0.03, p.y);
      const pos: number[] = [];
      const nrm: number[] = [];
      const uv: number[] = [];
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outline, [])) {
        for (const v of [outline[i], outline[j], outline[k]].map(world)) {
          pos.push(v.x, v.y, v.z);
          nrm.push(n.x, n.y, n.z);
          uv.push(0, 0);
        }
      }
      g.add(new THREE.Mesh(geometry(pos, nrm, uv), new THREE.MeshLambertMaterial({ color: f.gable.color, side: THREE.DoubleSide, emissive: '#1c1c1c' })));
      // Light trim along the arch.
      const trim = new THREE.MeshLambertMaterial({ color: '#efe6d4', side: THREE.DoubleSide, emissive: '#2a2a2a' });
      const tp: number[] = [];
      const tn: number[] = [];
      const tu: number[] = [];
      const edgePts = outline.slice(2);
      for (let i = 0; i + 1 < edgePts.length; i++) {
        const p0 = edgePts[i];
        const p1 = edgePts[i + 1];
        const d0 = new THREE.Vector2(gw / 2, shoulder).sub(p0).normalize().multiplyScalar(0.3);
        const d1 = new THREE.Vector2(gw / 2, shoulder).sub(p1).normalize().multiplyScalar(0.3);
        pushQuad(tp, tn, tu, [world(p0), world(p1), world(p1.clone().add(d1)).addScaledVector(n, 0.02), world(p0.clone().add(d0)).addScaledVector(n, 0.02)], n, UNIT);
      }
      g.add(new THREE.Mesh(geometry(tp, tn, tu), trim));
    }

    let above = bandBottom;
    if (f.band) {
      const bw = Math.min(f.band.width ?? 7, len - 0.6);
      const bh = f.band.height ?? 1.8;
      const [t0, t1] = span(bw);
      const tex = panelTexture(f.band.color, f.band.text, f.band.textColor ?? '#ffffff', bw, bh, f.band.pattern === 'tile');
      const b0 = f.band.bottom ?? bandBottom;
      const cap = f.gable ? h + f.gable.rise * 0.45 : h - 0.95;
      quad(front.edge, t0, t1, b0, Math.min(b0 + bh, cap), 0.07, new THREE.MeshLambertMaterial({ map: tex, emissive: '#202020' }));
      above = b0 + bh;
      if (f.posts) {
        const post = new THREE.MeshLambertMaterial({ color: f.posts });
        const pw = 0.35 / len;
        quad(front.edge, t0, t0 + pw, 0, bandBottom, 0.09, post);
        quad(front.edge, t1 - pw, t1, 0, bandBottom, 0.09, post);
      }
    }
    if (f.letters) {
      const z0 = above + 0.2;
      const z1 = Math.min(h - 1.1, z0 + 2.4);
      if (z1 - z0 > 0.7) {
        const lw = Math.min(len - 1, (z1 - z0) * 0.62 * f.letters.text.length);
        const [t0, t1] = span(lw);
        const tex = lettersTexture(f.letters.text, f.letters.color, lw, z1 - z0);
        quad(front.edge, t0, t1, z0, z1, 0.08, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, emissive: '#1a1a1a' }));
      }
    }
    if (f.corner) {
      // The street corner (two street walls meeting) nearest this shop.
      let best: { v: number; d: number } | null = null;
      ring.forEach((p, v) => {
        const prev = (v - 1 + ring.length) % ring.length;
        if (!onStreet[prev] || !onStreet[v]) return;
        const d = Math.hypot(p[0] - front.storefront[0], p[1] - front.storefront[1]);
        if (!best || d < best.d) best = { v, d };
      });
      if (best) {
        const v = (best as { v: number }).v;
        const tex = cornerTexture(f.corner.lines, f.corner.color, f.corner.bg);
        const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#1a1a1a' });
        const z0 = bandBottom;
        const z1 = Math.min(h - 1.0, z0 + 2.0);
        const prev = (v - 1 + ring.length) % ring.length;
        const lp = wall(prev).len;
        const ln = wall(v).len;
        quad(prev, 1 - 2.2 / lp, 1 - 0.6 / lp, z0, z1, 0.1, mat);
        quad(v, 0.6 / ln, 2.2 / ln, z0, z1, 0.1, mat);
      }
    }
  }
}

/** Position (0-1) of a point along wall `edge` of a ring. */
export function wallT(ring: Pt[], edge: number, p: Pt): number {
  const a = ring[edge];
  const b = ring[(edge + 1) % ring.length];
  return nearestOnLine([a, b], p).s / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
}
