// Turns data-raw/ into the compact files the site uses:
//   public/data/sunnyside.json  (shipped to visitors)
//   dev-data/buildings.json, dev-data/pois.json  (Build mode only; never shipped)
// Run after `npm run fetch-data`: `npm run build-data`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  distToRing,
  distToSegment,
  makeProjection,
  normalizeRing,
  pointInPolygon,
  pointInRing,
  rng,
  round1,
  lineLength,
  signedArea,
  simplifyLine,
  simplifyRing,
  stitchLines,
  stitchRings,
  type Pt,
} from '../src/geo.ts';
import type { AreaKind, DevBuilding, DevPoi, MapData } from '../src/mapdata.ts';
import { roadLayer, roadStyle } from '../src/roads.ts';

const RAW = new URL('../data-raw/', import.meta.url);
const MARGIN = 400; // meters of context drawn around the boundary
const FRINGE = 90; // meters of forest band just outside the boundary

interface LatLon {
  lat: number;
  lon: number;
}
interface OsmEl {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  members?: Array<{ type: string; role: string; geometry?: LatLon[] }>;
  lat?: number;
  lon?: number;
  center?: LatLon;
}

const readRaw = async <T>(name: string): Promise<T> => JSON.parse(await readFile(new URL(name, RAW), 'utf8')) as T;
const flat = (pts: Pt[]) => pts.flatMap(([x, y]) => [round1(x), round1(y)]);

async function main() {
  // ---- Boundary and projection -------------------------------------------------------------
  const boundaryGeo = await readRaw<{ coordinates: number[][][][] }>('boundary.json');
  const allLL = boundaryGeo.coordinates.flat(2);
  const lons = allLL.map((p) => p[0]);
  const lats = allLL.map((p) => p[1]);
  const origin = {
    lon: +((Math.min(...lons) + Math.max(...lons)) / 2).toFixed(6),
    lat: +((Math.min(...lats) + Math.max(...lats)) / 2).toFixed(6),
  };
  const proj = makeProjection(origin.lon, origin.lat);
  const P = (g: LatLon): Pt => proj.toLocal(g.lon, g.lat);

  const boundary: Pt[][][] = boundaryGeo.coordinates.map((poly) =>
    poly.map((ring) => simplifyRing(normalizeRing(ring.map(([lon, lat]) => proj.toLocal(lon, lat))), 1)!).filter(Boolean),
  );
  const bPts = boundary.flat(2);
  const core = {
    minX: Math.min(...bPts.map((p) => p[0])),
    minY: Math.min(...bPts.map((p) => p[1])),
    maxX: Math.max(...bPts.map((p) => p[0])),
    maxY: Math.max(...bPts.map((p) => p[1])),
  };
  const bounds = { minX: core.minX - MARGIN, minY: core.minY - MARGIN, maxX: core.maxX + MARGIN, maxY: core.maxY + MARGIN };
  const inBounds = (x: number, y: number) => x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  const insideBoundary = (x: number, y: number) => boundary.some((poly) => pointInPolygon(x, y, poly));
  const distOutside = (x: number, y: number) => Math.min(...boundary.map((poly) => distToRing(x, y, poly[0])));

  /** Keeps only the parts of a polyline inside the boundary or within `maxOut` meters of it (3D
   *  structures cannot use the ground fade, so they are cut off inside the forest band instead). */
  const clipNearBoundary = (line: number[], maxOut: number): number[][] => {
    const runs: number[][] = [];
    let run: number[] = [];
    const keep = (x: number, y: number) => insideBoundary(x, y) || distOutside(x, y) <= maxOut;
    for (let i = 0; i + 1 < line.length; i += 2) {
      const [ax, ay] = [line[i], line[i + 1]];
      const next = i + 3 < line.length ? [line[i + 2], line[i + 3]] : null;
      const steps = next ? Math.max(1, Math.ceil(Math.hypot(next[0] - ax, next[1] - ay) / 5)) : 1;
      for (let k = 0; k < steps; k++) {
        const x = next ? ax + ((next[0] - ax) * k) / steps : ax;
        const y = next ? ay + ((next[1] - ay) * k) / steps : ay;
        if (keep(x, y)) run.push(round1(x), round1(y));
        else if (run.length) {
          if (run.length >= 4) runs.push(run);
          run = [];
        }
      }
    }
    if (run.length >= 4) runs.push(run);
    return runs.map((r) => flat(simplifyLine(toPts(r), 0.5)));
  };
  const toPts = (f: number[]): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
    return out;
  };

  // ---- OSM base layers -----------------------------------------------------------------------
  const base = await readRaw<{ elements: OsmEl[] }>('osm-base.json');
  const roads: MapData['roads'] = [];
  const rails: number[][] = [];
  const viaduct: number[][] = [];
  const areas: Array<{ k: AreaKind; r: Pt[][] }> = [];
  const viaductPieces: Pt[][] = [];

  const classify = (t: Record<string, string>): AreaKind | null => {
    if (t.natural === 'water') return 'water';
    if (t.landuse === 'railway' || t.railway === 'yard') return 'rail';
    if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
    if (t.natural === 'wood') return 'wood';
    if (t.leisure === 'pitch') return 'pitch';
    if (t.leisure === 'playground') return 'playground';
    if (['park', 'garden', 'recreation_ground', 'dog_park'].includes(t.leisure) || ['recreation_ground', 'village_green'].includes(t.landuse))
      return 'park';
    if (t.landuse === 'grass') return 'grass';
    return null;
  };

  const addPolygons = (kind: AreaKind, outers: Pt[][], inners: Pt[][]) => {
    for (const o of outers) {
      const outer = simplifyRing(normalizeRing(o), 0.5);
      if (!outer) continue;
      const holes = inners
        .map((h) => simplifyRing(normalizeRing(h), 0.5))
        .filter((h): h is Pt[] => !!h && pointInRing(h[0][0], h[0][1], outer));
      areas.push({ k: kind, r: [outer, ...holes] });
    }
  };

  for (const el of base.elements) {
    const t = el.tags ?? {};
    if (el.type === 'way' && el.geometry) {
      const pts = el.geometry.map(P);
      if (t.highway) {
        const style = roadStyle(t);
        if (!style || pts.length < 2) continue;
        roads.push({
          ...(t.name ? { n: t.name } : {}),
          w: round1(style.w),
          sw: round1(style.sw),
          ln: style.lines ? 1 : 0,
          l: roadLayer(t),
          p: flat(simplifyLine(pts, 0.4)),
        });
        continue;
      }
      if (['rail', 'subway', 'light_rail'].includes(t.railway)) {
        if (t.tunnel === 'yes' || t.tunnel === 'building_passage') continue;
        const layer = Number.parseInt(t.layer ?? '0', 10) || 0;
        const line = flat(simplifyLine(pts, 0.5));
        if (t.railway === 'subway' && t.bridge && t.bridge !== 'no' && layer >= 1) viaductPieces.push(pts);
        else rails.push(line);
        continue;
      }
      const kind = classify(t);
      const first = el.geometry[0];
      const last = el.geometry[el.geometry.length - 1];
      if (kind && first.lat === last.lat && first.lon === last.lon) addPolygons(kind, [pts], []);
    } else if (el.type === 'relation' && el.members) {
      const kind = classify(t);
      if (!kind) continue;
      const frag = (role: string) => el.members!.filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => m.geometry!.map(P));
      addPolygons(kind, stitchRings(frag('outer')), stitchRings(frag('inner')));
    }
  }

  // Elevated tracks: join OSM pieces into whole tracks (trains run along them), then trim at the edge.
  for (const chain of stitchLines(viaductPieces)) viaduct.push(...clipNearBoundary(flat(chain), 40));

  // ---- Spatial index of obstacles (roads, rails, viaduct) for tree placement ---------------------
  const CELL = 40;
  type Seg = { ax: number; ay: number; bx: number; by: number; clear: number; asphalt: number };
  const grid = new Map<string, Seg[]>();
  const addSeg = (s: Seg) => {
    const pad = s.clear;
    const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL);
    const x1 = Math.floor((Math.max(s.ax, s.bx) + pad) / CELL);
    const y0 = Math.floor((Math.min(s.ay, s.by) - pad) / CELL);
    const y1 = Math.floor((Math.max(s.ay, s.by) + pad) / CELL);
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx},${gy}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
      }
  };
  const eachSeg = (p: number[], clear: number, asphalt: number) => {
    for (let i = 0; i + 3 < p.length; i += 2) addSeg({ ax: p[i], ay: p[i + 1], bx: p[i + 2], by: p[i + 3], clear, asphalt });
  };
  for (const r of roads) if (r.l === 0) eachSeg(r.p, r.w / 2 + r.sw + 1.2, r.w / 2);
  for (const r of rails) eachSeg(r, 3, 0);
  for (const v of viaduct) eachSeg(v, 7, 0);
  const segsNear = (x: number, y: number) => grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? [];
  const blocked = (x: number, y: number) => segsNear(x, y).some((s) => distToSegment(x, y, s.ax, s.ay, s.bx, s.by) < s.clear);

  // Area lookup by bbox bucket.
  const areaIndex = new Map<string, number[]>();
  areas.forEach((a, i) => {
    const xs = a.r[0].map((p) => p[0]);
    const ys = a.r[0].map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / 100); gx <= Math.floor(Math.max(...xs) / 100); gx++)
      for (let gy = Math.floor(Math.min(...ys) / 100); gy <= Math.floor(Math.max(...ys) / 100); gy++) {
        const k = `${gx},${gy}`;
        (areaIndex.get(k) ?? areaIndex.set(k, []).get(k)!).push(i);
      }
  });
  const areaAt = (x: number, y: number): AreaKind | null => {
    const order: AreaKind[] = ['water', 'rail', 'pitch', 'playground', 'wood', 'cemetery', 'park', 'grass'];
    let best: AreaKind | null = null;
    for (const i of areaIndex.get(`${Math.floor(x / 100)},${Math.floor(y / 100)}`) ?? []) {
      const a = areas[i];
      if (pointInPolygon(x, y, a.r) && (best === null || order.indexOf(a.k) < order.indexOf(best))) best = a.k;
    }
    return best;
  };

  // ---- Trees ------------------------------------------------------------------------------------
  const CONIFERS = /^(Pinus|Picea|Abies|Taxus|Juniperus|Cedrus|Thuja|Pseudotsuga|Metasequoia|Taxodium|Chamaecyparis|Cryptomeria|Tsuga)/;
  const rawTrees = await readRaw<Array<{ location?: { coordinates: [number, number] }; dbh?: string; genusspecies?: string }>>('trees.json');
  const trees: number[] = [];
  let pushed = 0;
  let streetCount = 0;
  for (const t of rawTrees) {
    if (!t.location) continue;
    let [x, y] = proj.toLocal(t.location.coordinates[0], t.location.coordinates[1]);
    if (!inBounds(x, y)) continue;
    if (!insideBoundary(x, y) && distOutside(x, y) > FRINGE) continue;
    // Nudge trees that our road widths put on the asphalt back onto the sidewalk.
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const s of segsNear(x, y)) {
        if (s.asphalt <= 0) continue;
        const d = distToSegment(x, y, s.ax, s.ay, s.bx, s.by);
        if (d >= s.asphalt + 0.5) continue;
        const dx = s.bx - s.ax;
        const dy = s.by - s.ay;
        const len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len;
        let ny = dx / len;
        const side = (x - s.ax) * nx + (y - s.ay) * ny;
        if (side < 0) {
          nx = -nx;
          ny = -ny;
        }
        const move = s.asphalt + 0.8 - d;
        x += nx * move;
        y += ny * move;
        moved = true;
      }
      if (!moved) break;
      if (iter === 0) pushed++;
    }
    const dbh = Number.parseFloat(t.dbh ?? '') || 8;
    const h = Math.min(16, Math.max(4, 4 + dbh * 0.33));
    const conifer = CONIFERS.test(t.genusspecies ?? '');
    trees.push(round1(x), round1(y), round1(h), conifer ? 2 : (Math.round(x * 7 + y * 13) & 1));
    streetCount++;
  }

  // Decorative scatter on a jittered 6 m grid, seeded so it is stable between runs.
  const rand = rng(20260919);
  const STEP = 6;
  let scatterCount = 0;
  for (let gx = bounds.minX; gx < bounds.maxX; gx += STEP) {
    for (let gy = bounds.minY; gy < bounds.maxY; gy += STEP) {
      const x = gx + rand() * STEP;
      const y = gy + rand() * STEP;
      const roll = rand();
      const typeRoll = rand();
      const sizeRoll = rand();
      let p: number;
      let coniferShare: number;
      const inside = insideBoundary(x, y);
      if (!inside) {
        if (distOutside(x, y) > FRINGE) continue;
        p = 0.34;
        coniferShare = 0.85;
      } else {
        const kind = areaAt(x, y);
        if (kind === 'water' || kind === 'rail' || kind === 'pitch' || kind === 'playground') continue;
        p = kind === 'wood' ? 0.8 : kind === 'park' ? 0.22 : kind === 'cemetery' ? 0.12 : kind === 'grass' ? 0.08 : 0.028;
        coniferShare = kind === 'wood' ? 0.85 : kind === 'cemetery' ? 0.3 : 0.45;
      }
      if (roll > p) continue;
      if (!inside && areaAt(x, y) === 'water') continue;
      if (blocked(x, y)) continue;
      const conifer = typeRoll < coniferShare;
      const h = conifer ? 8 + sizeRoll * 7 : 6 + sizeRoll * 7;
      trees.push(round1(x), round1(y), round1(h), conifer ? 2 + (sizeRoll > 0.5 ? 1 : 0) : sizeRoll > 0.5 ? 1 : 0);
      scatterCount++;
    }
  }

  // ---- Dominant street-grid angle ---------------------------------------------------------------
  const hist = new Float64Array(90);
  for (const r of roads) {
    if (r.l !== 0 || r.w < 8) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const dx = r.p[i + 2] - r.p[i];
      const dy = r.p[i + 3] - r.p[i + 1];
      const len = Math.hypot(dx, dy);
      const deg = (((Math.atan2(dy, dx) * 180) / Math.PI) % 90 + 90) % 90;
      hist[Math.floor(deg) % 90] += len;
    }
  }
  let gridAngle = 0;
  let bestScore = -1;
  for (let i = 0; i < 90; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += hist[(i + k + 90) % 90];
    if (s > bestScore) {
      bestScore = s;
      gridAngle = i + 0.5;
    }
  }

  // ---- Write public data ------------------------------------------------------------------------
  const areaOrder: AreaKind[] = ['grass', 'park', 'wood', 'cemetery', 'rail', 'water', 'pitch', 'playground'];
  areas.sort((a, b) => areaOrder.indexOf(a.k) - areaOrder.indexOf(b.k));
  const r1 = (b: typeof core) => ({ minX: round1(b.minX), minY: round1(b.minY), maxX: round1(b.maxX), maxY: round1(b.maxY) });
  const data: MapData = {
    origin,
    bounds: r1(bounds),
    core: r1(core),
    gridAngle,
    boundary: boundary.map((poly) => poly.map(flat)),
    roads,
    areas: areas.map((a) => ({ k: a.k, r: a.r.map(flat) })),
    rails,
    viaduct,
    trees,
  };

  const asserts: Array<[boolean, string]> = [
    [roads.length > 400, `roads ${roads.length} > 400`],
    [streetCount > 4000, `street trees ${streetCount} > 4000`],
    [boundary.length >= 1 && boundary[0][0].length >= 10, 'boundary has a real outline'],
    [viaduct.length > 0, `viaduct segments ${viaduct.length} > 0`],
    [areas.some((a) => a.k === 'park'), 'has parks'],
  ];
  for (const [ok, msg] of asserts) if (!ok) throw new Error(`Sanity check failed: ${msg}`);

  await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
  const json = JSON.stringify(data);
  await writeFile(new URL('../public/data/sunnyside.json', import.meta.url), json);

  // ---- Dev-only: building outlines and named places ---------------------------------------------
  const bRaw = await readRaw<{ elements: OsmEl[] }>('osm-buildings.json');
  const buildings: DevBuilding[] = [];
  for (const el of bRaw.elements) {
    const t = el.tags ?? {};
    let ring: Pt[] | undefined;
    if (el.type === 'way' && el.geometry) ring = el.geometry.map(P);
    else if (el.type === 'relation' && el.members) {
      const outers = stitchRings(el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry!.map(P)));
      ring = outers.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
    }
    if (!ring || ring.length < 4) continue;
    const norm = normalizeRing(ring);
    if (norm.length < 3) continue;
    const h = Number.parseFloat(t.height ?? '');
    const lv = Number.parseInt(t['building:levels'] ?? '', 10);
    const a = t['addr:housenumber'] && t['addr:street'] ? `${t['addr:housenumber']} ${t['addr:street']}` : undefined;
    buildings.push({
      id: `${el.type[0]}${el.id}`,
      ...(Number.isFinite(h) ? { h } : {}),
      ...(Number.isFinite(lv) ? { lv } : {}),
      ...(a ? { a } : {}),
      r: flat(norm),
    });
  }

  const pRaw = await readRaw<{ elements: OsmEl[] }>('osm-pois.json');
  const pois: DevPoi[] = [];
  for (const el of pRaw.elements) {
    const t = el.tags ?? {};
    const c = el.center ?? (el.lat !== undefined ? { lat: el.lat, lon: el.lon! } : undefined);
    if (!c || !t.name) continue;
    const [x, y] = P(c);
    const a = t['addr:housenumber'] && t['addr:street'] ? `${t['addr:housenumber']} ${t['addr:street']}` : undefined;
    pois.push({ n: t.name, t: t.shop ?? t.amenity ?? t.craft ?? t.office ?? t.tourism ?? t.leisure ?? '', x: round1(x), y: round1(y), ...(a ? { a } : {}) });
  }

  await mkdir(new URL('../dev-data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../dev-data/buildings.json', import.meta.url), JSON.stringify(buildings));
  await writeFile(new URL('../dev-data/pois.json', import.meta.url), JSON.stringify(pois));

  console.log(
    [
      `origin ${origin.lon}, ${origin.lat}; core ${(core.maxX - core.minX).toFixed(0)} x ${(core.maxY - core.minY).toFixed(0)} m; grid angle ${gridAngle} deg`,
      `roads ${roads.length} (bridges ${roads.filter((r) => r.l > 0).length}), areas ${areas.length}, rails ${rails.length}`,
      `elevated tracks ${viaduct.length}: ${viaduct.map((v) => Math.round(lineLength(toPts(v)))).sort((a, b) => b - a).join(', ')} m`,
      `trees ${trees.length / 4} (street ${streetCount}, ${pushed} nudged off asphalt; scatter ${scatterCount})`,
      `public/data/sunnyside.json ${(json.length / 1024).toFixed(0)} KB`,
      `dev-data: ${buildings.length} buildings, ${pois.length} named places`,
    ].join('\n'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
