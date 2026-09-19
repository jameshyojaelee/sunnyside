// Shape of public/data/sunnyside.json. Coordinates are local meters (see geo.ts), rounded to 0.1 m,
// stored as flat [x0, y0, x1, y1, ...] arrays to keep the file small.

export type AreaKind = 'park' | 'grass' | 'wood' | 'cemetery' | 'rail' | 'water' | 'pitch' | 'playground';

export interface MapData {
  origin: { lon: number; lat: number };
  /** Extent of all data (boundary + margin). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Extent of the Sunnyside boundary itself. */
  core: { minX: number; minY: number; maxX: number; maxY: number };
  /** Dominant street-grid bearing in degrees [0, 90). */
  gridAngle: number;
  /** Sunnyside boundary polygons: each is [outer, ...holes]. */
  boundary: number[][][];
  /** Roads: name, curb-to-curb width, sidewalk width, edge lines, draw layer, polyline. */
  roads: Array<{ n?: string; w: number; sw: number; ln: 0 | 1; l: number; p: number[] }>;
  areas: Array<{ k: AreaKind; r: number[][] }>;
  /** Railway tracks at ground level. */
  rails: number[][];
  /** Elevated subway structure centerlines (7 train, N/W). */
  viaduct: number[][];
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
