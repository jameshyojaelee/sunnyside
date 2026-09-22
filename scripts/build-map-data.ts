// Turns data-raw/ into the compact files the site uses:
//   public/data/sunnyside.json  (shipped to visitors)
//   dev-data/buildings.json, dev-data/pois.json  (Build mode only; never shipped)
// Run after `npm run fetch-data`: `npm run build-data`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import {
  distToRing,
  distToSegment,
  makeProjection,
  normalizeRing,
  pointInPolygon,
  pointInRing,
  regionNorthOf,
  rng,
  round1,
  lineLength,
  signedArea,
  simplifyLine,
  simplifyRing,
  sliceLine,
  stitchLines,
  stitchRings,
  streetMeetsLine,
  type Pt,
} from '../src/geo.ts';
import { corridorPieces, offsetLine } from '../src/corridor.ts';
import { PARK_LOOKS } from '../src/data/parkLooks.ts';
import type { AreaKind, DevBuilding, DevPoi, MapData, PropKind } from '../src/mapdata.ts';
import { roadLayer, roadStyle } from '../src/roads.ts';

const RAW = new URL('../data-raw/', import.meta.url);
const MARGIN = 400; // meters of context drawn around the boundary
const FRINGE = 90; // meters of forest band just outside the boundary
const CORRIDOR = 100; // tracks this close to the north edge are shown, with the ground between

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

  // Our Sunnyside ends at the Long Island Expressway: everything south of it (Calvary Cemetery,
  // Blissville, the blocks below the BQE interchange) is left out, per the site owners. The cut
  // runs along the LIE's northernmost carriageway edge. The origin above stays on the official
  // NTA extent so coordinates don't shift if this rule changes.
  const base = await readRaw<{ elements: OsmEl[] }>('osm-base.json');
  const lie = base.elements
    .filter((e) => e.type === 'way' && e.tags?.highway === 'motorway' && e.tags?.ref === 'I 495' && e.geometry)
    .map((e) => e.geometry!.map(P));
  const nta = boundaryGeo.coordinates.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => proj.toLocal(lon, lat))));
  const ntaXs = nta.flat(2).map((p) => p[0]);
  const ntaYs = nta.flat(2).map((p) => p[1]);
  const north = regionNorthOf(lie, 9, Math.min(...ntaXs) - 100, Math.max(...ntaXs) + 100, Math.max(...ntaYs) + 100);
  const trimmed = polygonClipping.intersection(nta as Polygon[], [[...north, north[0]]] as Polygon);
  const cleanPolys = (polys: number[][][][]): Pt[][][] =>
    polys
      .map((poly) => poly.map((ring) => simplifyRing(normalizeRing(ring as Pt[]), 1)).filter((r): r is Pt[] => !!r))
      .filter((poly) => poly.length && Math.abs(signedArea(poly[0])) > 5000);
  const neighborhood = cleanPolys(trimmed);
  if (!neighborhood.length) throw new Error('Boundary vanished after the LIE cut');

  // Sunnyside Yard and the LIRR lines run just outside the north edge. Keep the nearest tracks
  // visible (not faded into forest), with the ground between them and the neighborhood. Only the
  // north side: the freight line near the LIE stays hidden.
  const ntaMidY = (Math.min(...nta.flat(2).map((p) => p[1])) + Math.max(...nta.flat(2).map((p) => p[1]))) / 2;
  const tracks = base.elements
    .filter((e) => e.type === 'way' && e.tags?.railway === 'rail' && !e.tags.tunnel && e.geometry)
    .map((e) => simplifyLine(e.geometry!.map(P), 0.5))
    .filter((t) => t.some((p) => p[1] > ntaMidY));
  const mainOutline = neighborhood.slice().sort((a, b) => Math.abs(signedArea(b[0])) - Math.abs(signedArea(a[0])))[0][0];
  const distToHood = (p: Pt) => (neighborhood.some((poly) => pointInPolygon(p[0], p[1], poly)) ? 0 : Math.min(...neighborhood.map((poly) => distToRing(p[0], p[1], poly[0]))));
  const pieces = corridorPieces(tracks, mainOutline, distToHood, CORRIDOR, 9);
  const withCorridor = polygonClipping.union(neighborhood.map((poly) => poly.map((r) => [...r, r[0]])) as Polygon[], ...pieces.bands, ...pieces.between);
  const boundary = cleanPolys(withCorridor).map((poly) => poly.slice(0, 1)); // no holes: gaps between tracks stay visible
  // The corridor itself: railway ground, and no forest scattered over the tracks.
  const hoodPolys = neighborhood.map((poly) => poly.map((r) => [...r, r[0]])) as Polygon[];
  const corridorOnly = cleanPolys(polygonClipping.difference(boundary.map((poly) => poly.map((r) => [...r, r[0]])) as Polygon[], hoodPolys));
  const inCorridor = (x: number, y: number) => corridorOnly.some((poly) => pointInPolygon(x, y, poly));
  // Ballast under the tracks themselves; the land between them and the streets stays plain.
  const ballast = cleanPolys(polygonClipping.difference(polygonClipping.union(pieces.bands[0], ...pieces.bands.slice(1)) as Polygon[], hoodPolys)).map((poly) => poly.slice(0, 1));
  const distToHoodEdge = (x: number, y: number) => Math.min(...neighborhood.map((poly) => distToRing(x, y, poly[0])));
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
  const roads: MapData['roads'] = [];
  const rails: number[][] = [];
  const thirdRails: number[][] = [];
  const viaduct: number[][] = [];
  const areas: Array<{ k: AreaKind; r: Pt[][]; id?: string; s?: string }> = [];
  const viaductPieces: Pt[][] = [];
  // Main-line railroad ways (LIRR, Amtrak), kept whole: where they run up on an embankment is
  // worked out from their bridges once every piece is in.
  const railWays: Array<{ pts: Pt[]; name: string; bridge: boolean; e: boolean }> = [];

  const classify = (t: Record<string, string>): AreaKind | null => {
    if (t.natural === 'water') return 'water';
    if (t.landuse === 'railway' || t.railway === 'yard') return 'rail';
    if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
    if (t.natural === 'wood') return 'wood';
    if (t.leisure === 'pitch') return 'pitch';
    if (t.leisure === 'playground') return 'playground';
    if (t.leisure === 'dog_park') return 'dogrun';
    if (['park', 'garden', 'recreation_ground'].includes(t.leisure) || ['recreation_ground', 'village_green'].includes(t.landuse))
      return 'park';
    if (t.landuse === 'grass') return 'grass';
    return null;
  };

  // Parks, courts and play areas keep their OSM id (for hand-tuned looks) and sport.
  const areaMeta = (el: OsmEl, t: Record<string, string>) =>
    t.leisure ? { id: `${el.type[0]}${el.id}`, ...(t.sport ? { s: t.sport } : {}) } : {};
  for (const poly of ballast) areas.push({ k: 'rail', r: poly });

  const addPolygons = (kind: AreaKind, outers: Pt[][], inners: Pt[][], meta: { id?: string; s?: string } = {}) => {
    for (const o of outers) {
      const outer = simplifyRing(normalizeRing(o), 0.5);
      if (!outer) continue;
      const holes = inners
        .map((h) => simplifyRing(normalizeRing(h), 0.5))
        .filter((h): h is Pt[] => !!h && pointInRing(h[0][0], h[0][1], outer));
      areas.push({ k: kind, r: [outer, ...holes], ...meta });
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
        const onBridge = !!t.bridge && t.bridge !== 'no' && layer >= 1;
        if (t.railway === 'subway' && onBridge) viaductPieces.push(pts);
        else if (t.railway === 'rail') railWays.push({ pts, name: t.name ?? '', bridge: onBridge, e: t.electrified === 'rail' });
        else rails.push(line);
        continue;
      }
      const kind = classify(t);
      const first = el.geometry[0];
      const last = el.geometry[el.geometry.length - 1];
      if (kind && first.lat === last.lat && first.lon === last.lon) addPolygons(kind, [pts], [], areaMeta(el, t));
    } else if (el.type === 'relation' && el.members) {
      const kind = classify(t);
      if (!kind) continue;
      const frag = (role: string) => el.members!.filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => m.geometry!.map(P));
      addPolygons(kind, stitchRings(frag('outer')), stitchRings(frag('inner')), areaMeta(el, t));
    }
  }

  // Elevated tracks: join OSM pieces into whole tracks (trains run along them), then trim at the edge.
  for (const chain of stitchLines(viaductPieces)) viaduct.push(...clipNearBoundary(flat(chain), 40));

  // Where the LIRR, the Port Washington Branch and Amtrak's Northeast Corridor leave the yard they
  // climb onto an embankment and stay up, street after street, all the way across Woodside. OSM only
  // tags the spans themselves as bridges, so each route is stitched back together and the short
  // at-grade gaps between its bridges are treated as more embankment. Girders are drawn over the
  // streets; the rest is bank, with a ramp at each end back down to the yard.
  const ELEVATED_GAP = 550; // an at-grade run shorter than this is really the same embankment
  const APPROACH = 90; // meters of ramp drawn at each end of an elevated run
  const elevatedRail: NonNullable<MapData['elevatedRail']> = [];
  const groundRails: Array<{ pts: Pt[]; e: boolean }> = [];
  // OSM renames the LIRR's main line halfway across the map; the route is one line, and it has to
  // stitch as one or the embankment through Woodside breaks in the middle.
  const route = (name: string) => (name === 'LIRR Main Line' ? 'Main Line' : name);
  const routes = new Map<string, typeof railWays>();
  for (const w of railWays) {
    const key = route(w.name);
    (routes.get(key) ?? routes.set(key, []).get(key)!).push(w);
  }
  for (const ways of routes.values()) {
    const electrified = ways.filter((w) => w.e).length * 2 > ways.length;
    const bridgeSegs: Array<[Pt, Pt]> = [];
    for (const w of ways.filter((w) => w.bridge)) for (let i = 1; i < w.pts.length; i++) bridgeSegs.push([w.pts[i - 1], w.pts[i]]);
    for (const chain of stitchLines(ways.map((w) => w.pts))) {
      const cum = [0];
      for (let i = 1; i < chain.length; i++) cum.push(cum[i - 1] + Math.hypot(chain[i][0] - chain[i - 1][0], chain[i][1] - chain[i - 1][1]));
      // A segment is a bridge span when its midpoint sits on one of the bridge ways.
      const onBridge = chain.slice(1).map((p, i) => {
        const mid: Pt = [(p[0] + chain[i][0]) / 2, (p[1] + chain[i][1]) / 2];
        return bridgeSegs.some(([a, b]) => distToSegment(mid[0], mid[1], a[0], a[1], b[0], b[1]) < 1.5);
      });
      if (!onBridge.some(Boolean)) {
        groundRails.push({ pts: chain, e: electrified });
        continue;
      }
      // Bridge spans as segment-index ranges, then merged into elevated runs across short gaps.
      const spans: Array<[number, number]> = [];
      for (let i = 0; i < onBridge.length; i++) {
        if (!onBridge[i]) continue;
        const start = i;
        while (i + 1 < onBridge.length && onBridge[i + 1]) i++;
        spans.push([start, i + 1]);
      }
      const runs: Array<[number, number]> = [];
      for (const span of spans) {
        const last = runs[runs.length - 1];
        if (last && cum[span[0]] - cum[last[1]] < ELEVATED_GAP) last[1] = span[1];
        else runs.push([...span]);
      }
      /** The chain between two vertices, cut to `limit` meters when walking outward from `from`. */
      const slice = (from: number, to: number, limit = Infinity): Pt[] => {
        const dir = Math.sign(to - from) || 1;
        const out: Pt[] = [chain[from]];
        for (let i = from + dir; i >= 0 && i < chain.length && dir * (to - i) >= 0; i += dir) {
          const d = Math.abs(cum[i] - cum[from]);
          if (d >= limit) {
            const prev = i - dir;
            const k = (limit - Math.abs(cum[prev] - cum[from])) / (Math.abs(cum[i] - cum[prev]) || 1);
            out.push([chain[prev][0] + (chain[i][0] - chain[prev][0]) * k, chain[prev][1] + (chain[i][1] - chain[prev][1]) * k]);
            break;
          }
          out.push(chain[i]);
        }
        return out;
      };
      let groundFrom = 0;
      // The line stays up where it leaves the map, so a run that reaches the edge is carried out to
      // the end of the chain instead of ramping down; inside the map it is cut at the drawn edge.
      const drawn = (q: Pt) => inBounds(q[0], q[1]);
      const leaving = (i: number) => !insideBoundary(chain[i][0], chain[i][1]) && distOutside(chain[i][0], chain[i][1]) > 120;
      for (const run of runs) {
        let [i0, i1] = run;
        while (i0 > 0 && drawn(chain[i0 - 1]) && leaving(i0 - 1)) i0--;
        while (i1 < chain.length - 1 && drawn(chain[i1 + 1]) && leaving(i1 + 1)) i1++;
        while (i0 < i1 && !drawn(chain[i0])) i0++;
        while (i1 > i0 && !drawn(chain[i1])) i1--;
        if (i1 - i0 < 1) continue;
        const approaches = [slice(i0, 0, APPROACH), slice(i1, chain.length - 1, APPROACH)].filter((a) => a.length >= 2);
        const onSpans = spans.filter(([a, b]) => a >= i0 && b <= i1);
        // The banked stretches are what is left of the run between its girder spans.
        const banks: Array<[number, number]> = [];
        let from = i0;
        for (const [a, b] of onSpans) {
          if (a > from) banks.push([from, a]);
          from = b;
        }
        if (from < i1) banks.push([from, i1]);
        elevatedRail.push({
          p: flat(simplifyLine(slice(i0, i1), 0.5)),
          s: onSpans.map(([a, b]) => flat(slice(a, b))),
          k: banks.map(([a, b]) => flat(simplifyLine(slice(a, b), 0.5))),
          a: approaches.map((a) => flat(simplifyLine(a, 0.5))),
          ...(electrified ? { e: 1 as const } : {}),
        });
        // Ground track runs up to where the ramp starts, and picks up again past the far ramp.
        const rampStart = cum[i0] - APPROACH;
        const upto = chain.findIndex((_, i) => cum[i] > rampStart);
        if (upto > groundFrom + 1) groundRails.push({ pts: chain.slice(groundFrom, upto), e: electrified });
        const rampEnd = cum[i1] + APPROACH;
        groundFrom = Math.max(i1, chain.findIndex((_, i) => cum[i] >= rampEnd));
        if (groundFrom < 0) groundFrom = chain.length;
      }
      if (groundFrom < chain.length - 1) groundRails.push({ pts: chain.slice(groundFrom), e: electrified });
    }
  }
  for (const g of groundRails) {
    if (g.pts.length < 2) continue;
    const line = flat(simplifyLine(g.pts, 0.5));
    rails.push(line);
    // LIRR tracks carry a third rail (with a wooden cover board) beside the running rails.
    if (g.e) thirdRails.push(flat(offsetLine(toPts(line), 1.45)));
  }

  // The 7 train runs on an arched concrete viaduct above Queens Boulevard from 33rd to 48th
  // Street and on steel elsewhere (Wikipedia, "IRT Flushing Line"). OSM does not tag the material,
  // so each track is cut where it crosses those two streets.
  const viaductParts: MapData['viaductParts'] = [];
  const streetLines = (name: string) => roads.filter((r) => r.l === 0 && r.n === name).map((r) => toPts(r.p));
  const s33 = streetLines('33rd Street');
  const s48 = streetLines('48th Street');
  const concreteTracks: Pt[][] = [];
  for (const v of viaduct) {
    const pts = toPts(v);
    const len = lineLength(pts);
    // Streets end at the Queens Blvd service roads, about 15-20 m short of the tracks.
    const at33 = streetMeetsLine(pts, s33, 30);
    const at48 = streetMeetsLine(pts, s48, 30);
    const meanX = (a: number, b: number) => {
      const piece = sliceLine(pts, a, b);
      return piece.reduce((sum, p) => sum + p[0], 0) / piece.length;
    };
    let lo: number | undefined;
    let hi: number | undefined;
    if (at33 !== undefined && at48 !== undefined) [lo, hi] = [Math.min(at33, at48), Math.max(at33, at48)];
    else if (at48 !== undefined) [lo, hi] = meanX(0, at48) < meanX(at48, len) ? [0, at48] : [at48, len]; // concrete is west of 48th
    else if (at33 !== undefined) [lo, hi] = meanX(0, at33) > meanX(at33, len) ? [0, at33] : [at33, len]; // concrete is east of 33rd
    const push = (k: 'concrete' | 'steel', a: number, b: number) => {
      if (b - a < 1) return;
      const piece = sliceLine(pts, a, b);
      viaductParts.push({ k, p: flat(piece) });
      if (k === 'concrete') concreteTracks.push(piece);
    };
    if (lo === undefined || hi === undefined) push('steel', 0, len);
    else {
      push('steel', 0, lo);
      push('concrete', lo, hi);
      push('steel', hi, len);
    }
  }
  // One arched structure carries all concrete tracks: centered on the middle track, as wide as the
  // outermost tracks plus the deck half-width.
  const aqueduct: MapData['aqueduct'] = [];
  if (concreteTracks.length) {
    const ref = concreteTracks.slice().sort((a, b) => lineLength(b) - lineLength(a))[0];
    const [ax, ay] = ref[0];
    const [bx, by] = ref[ref.length - 1];
    const ul = Math.hypot(bx - ax, by - ay);
    const side = (t: Pt[]) => t.reduce((s, p) => s + (-(p[0] - ax) * (by - ay) + (p[1] - ay) * (bx - ax)) / ul, 0) / t.length;
    const ordered = concreteTracks.slice().sort((a, b) => side(a) - side(b));
    const center = ordered[Math.floor(ordered.length / 2)];
    const offsets = ordered.map((t) => side(t) - side(center));
    aqueduct.push({ p: flat(center), wl: round1(Math.max(0, ...offsets) + 3.2), wr: round1(Math.max(0, ...offsets.map((o) => -o)) + 3.2) });
  }

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
  for (const b of elevatedRail) {
    eachSeg(b.p, 8, 0);
    for (const a of b.a) eachSeg(a, 8, 0);
  }
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
    const order: AreaKind[] = ['water', 'rail', 'pitch', 'playground', 'dogrun', 'wood', 'cemetery', 'park', 'grass'];
    let best: AreaKind | null = null;
    for (const i of areaIndex.get(`${Math.floor(x / 100)},${Math.floor(y / 100)}`) ?? []) {
      const a = areas[i];
      if (pointInPolygon(x, y, a.r) && (best === null || order.indexOf(a.k) < order.indexOf(best))) best = a.k;
    }
    return best;
  };

  // ---- Playground equipment and park structures -------------------------------------------------
  const inPark = (x: number, y: number) => areas.some((a) => (a.k === 'park' || a.k === 'playground') && pointInPolygon(x, y, a.r));
  const parkRaw = await readRaw<{ elements: OsmEl[] }>('osm-parks.json');
  const props: MapData['props'] = [];
  const toiletRings: Pt[][] = [];
  const propKind = (t: Record<string, string>): PropKind | null => {
    const byPlay: Record<string, PropKind> = { structure: 'structure', swing: 'swing', climbingframe: 'climbingframe', splash_pad: 'splash', sandpit: 'sandpit' };
    if (t.playground) return byPlay[t.playground] ?? null;
    if (t.man_made === 'flagpole') return 'flagpole';
    if (t.building === 'toilets' || t.amenity === 'toilets') return 'toilets';
    return null;
  };
  // Buildings first, so a toilets node inside one isn't drawn twice.
  const parkEls = parkRaw.elements.slice().sort((a, b) => (a.type === 'way' ? 0 : 1) - (b.type === 'way' ? 0 : 1));
  for (const el of parkEls) {
    const t = el.tags ?? {};
    const k = propKind(t);
    if (!k) continue;
    const pts = el.type === 'node' ? [P({ lat: el.lat!, lon: el.lon! })] : (el.geometry ?? []).map(P);
    if (!pts.length) continue;
    const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
    const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
    if (!inBounds(cx, cy) || !inPark(cx, cy)) continue;
    if (k === 'toilets' && el.type === 'node' && toiletRings.some((r) => pointInRing(cx, cy, r))) continue;
    const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    const shape = el.type === 'node' ? undefined : closed ? normalizeRing(pts) : pts;
    if (k === 'toilets' && shape && closed) toiletRings.push(shape);
    const h = Number.parseFloat(t.height ?? '');
    props.push({
      k,
      x: round1(cx),
      y: round1(cy),
      ...(shape ? { [closed ? 'r' : 'l']: flat(shape) } : {}),
      ...(Number.isFinite(h) ? { h } : {}),
    });
  }

  // ---- Trees ------------------------------------------------------------------------------------
  // Parks we modeled after real life are paved: their trees grow along the edges and over shaded
  // play areas, not on the courts.
  const lookParks = areas.filter((a) => a.id && PARK_LOOKS[a.id]).map((a) => ({ ring: a.r[0], look: PARK_LOOKS[a.id!] }));
  const shadedRings = lookParks.flatMap((p) => areas.filter((a) => a.id && p.look.shaded.includes(a.id)).map((a) => a.r[0]));
  const lookTreeChance = (x: number, y: number): number | null => {
    const park = lookParks.find((p) => pointInRing(x, y, p.ring));
    if (!park) return null;
    // Keep clear of play equipment and park buildings.
    if (props.some((q) => Math.hypot(q.x - x, q.y - y) < 4 || (q.r && pointInRing(x, y, toPts(q.r))))) return 0;
    if (shadedRings.some((r) => pointInRing(x, y, r))) return park.look.treeDensity;
    const kind = areaAt(x, y);
    if (kind === 'pitch' || kind === 'playground' || kind === 'dogrun') return 0;
    return distToRing(x, y, park.ring) <= park.look.treeBand ? park.look.treeDensity : 0;
  };
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
      } else if (inCorridor(x, y)) {
        // Rail corridor: bare tracks, with the tree line that screens them from the streets.
        if (areaAt(x, y) === 'rail') continue;
        p = distToHoodEdge(x, y) <= 12 ? 0.25 : 0.05;
        coniferShare = 0.2;
      } else {
        const kind = areaAt(x, y);
        const modeled = lookTreeChance(x, y);
        if (modeled !== null) {
          p = modeled;
          coniferShare = 0.1;
        } else {
          if (kind === 'water' || kind === 'rail' || kind === 'pitch' || kind === 'playground') continue;
          p = kind === 'wood' ? 0.8 : kind === 'park' || kind === 'dogrun' ? 0.22 : kind === 'cemetery' ? 0.12 : kind === 'grass' ? 0.08 : 0.028;
          coniferShare = kind === 'wood' ? 0.85 : kind === 'cemetery' ? 0.3 : 0.45;
        }
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

  // ---- Drop anything entirely outside the drawn area --------------------------------------------
  const touches = (flatPts: number[]) => {
    for (let i = 0; i < flatPts.length; i += 2) if (inBounds(flatPts[i], flatPts[i + 1])) return true;
    return false;
  };
  const keptRoads = roads.filter((r) => touches(r.p));
  roads.length = 0;
  roads.push(...keptRoads);
  const keptRails = rails.filter(touches);
  rails.length = 0;
  rails.push(...keptRails);
  const keptAreas = areas.filter((a) => touches(flat(a.r[0])));
  areas.length = 0;
  areas.push(...keptAreas);

  // ---- Write public data ------------------------------------------------------------------------
  const areaOrder: AreaKind[] = ['grass', 'park', 'wood', 'cemetery', 'rail', 'water', 'dogrun', 'pitch', 'playground'];
  areas.sort((a, b) => areaOrder.indexOf(a.k) - areaOrder.indexOf(b.k));
  const r1 = (b: typeof core) => ({ minX: round1(b.minX), minY: round1(b.minY), maxX: round1(b.maxX), maxY: round1(b.maxY) });
  const data: MapData = {
    origin,
    bounds: r1(bounds),
    core: r1(core),
    gridAngle,
    boundary: boundary.map((poly) => poly.map(flat)),
    roads,
    areas: areas.map((a) => ({ k: a.k, r: a.r.map(flat), ...(a.id ? { id: a.id } : {}), ...(a.s ? { s: a.s } : {}) })),
    rails,
    thirdRails: thirdRails.filter(touches),
    elevatedRail,
    props,
    viaduct,
    viaductParts,
    aqueduct,
    trees,
  };

  const asserts: Array<[boolean, string]> = [
    [roads.length > 400, `roads ${roads.length} > 400`],
    [streetCount > 4000, `street trees ${streetCount} > 4000`],
    [boundary.length >= 1 && boundary[0][0].length >= 10, 'boundary has a real outline'],
    [viaduct.length > 0, `viaduct segments ${viaduct.length} > 0`],
    [elevatedRail.length > 0, `elevated rail runs ${elevatedRail.length} > 0`],
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
      `elevated rail ${elevatedRail.length} runs: ${elevatedRail.map((b) => Math.round(lineLength(toPts(b.p)))).sort((a, b) => b - a).join(', ')} m (${elevatedRail.reduce((n, b) => n + b.s.length, 0)} girder spans)`,
      `elevated tracks ${viaduct.length}: ${viaduct.map((v) => Math.round(lineLength(toPts(v)))).sort((a, b) => b - a).join(', ')} m`,
      `  concrete parts: ${viaductParts.filter((v) => v.k === 'concrete').map((v) => Math.round(lineLength(toPts(v.p)))).join(', ')} m; aqueduct width ${aqueduct.map((a) => `${a.wl}+${a.wr}`).join(', ')} m`,
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
