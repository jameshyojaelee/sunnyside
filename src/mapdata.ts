// Shape of public/data/sunnyside.json. Coordinates are local meters (see geo.ts), rounded to 0.1 m,
// stored as flat [x0, y0, x1, y1, ...] arrays to keep the file small.

export type AreaKind = 'park' | 'grass' | 'wood' | 'cemetery' | 'rail' | 'water' | 'pitch' | 'playground' | 'dogrun';

/** Playground equipment and park structures (OSM). */
export type PropKind = 'structure' | 'swing' | 'climbingframe' | 'splash' | 'sandpit' | 'flagpole' | 'toilets';

export interface MapData {
  origin: { lon: number; lat: number };
  /** Extent of all data (boundary + margin). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Extent of the Sunnyside boundary itself. */
  core: { minX: number; minY: number; maxX: number; maxY: number };
  /** Dominant street-grid bearing in degrees [0, 90). */
  gridAngle: number;
  /** Sunnyside boundary polygons, plus the rail corridor along the north edge, which is also drawn
   *  instead of fading into forest: each is [outer, ...holes]. */
  boundary: number[][][];
  /** Roads: name, curb-to-curb width, sidewalk width, edge lines, draw layer, polyline. */
  roads: Array<{ n?: string; w: number; sw: number; ln: 0 | 1; l: number; p: number[] }>;
  /** Land use. Parks, courts and play areas carry their OSM id (e.g. "w143295853") and sport. */
  areas: Array<{ k: AreaKind; r: number[][]; id?: string; s?: string }>;
  /** Railway tracks at ground level. */
  rails: number[][];
  /** LIRR third rails, beside their tracks. */
  thirdRails: number[][];
  /** Center, plus the outline (r) or line (l) when OSM maps the shape, and height if known. */
  props: Array<{ k: PropKind; x: number; y: number; r?: number[]; l?: number[]; h?: number }>;
  /** Elevated subway tracks (7 train), whole, for the trains. */
  viaduct: number[][];
  /** The same tracks split by structure: concrete arches over Queens Blvd (33rd-48th St) or steel. */
  viaductParts: Array<{ k: 'concrete' | 'steel'; p: number[] }>;
  /** The concrete viaduct as one structure: a centerline plus its width left and right of it. */
  aqueduct: Array<{ p: number[]; wl: number; wr: number }>;
  /** Trees, flat: x, y, height (m), type (0,1 = round; 2,3 = conifer). */
  trees: number[];
}

export interface DevBuilding {
  id: string;
  /** Height in meters if known. */
  h?: number;
  lv?: number;
  /** "46-10 Queens Boulevard" */
  a?: string;
  /** Outer ring, flat local meters. */
  r: number[];
}

export interface DevPoi {
  n: string;
  t: string;
  /** Local meters. */
  x: number;
  y: number;
  a?: string;
}
