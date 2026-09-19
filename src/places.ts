import { CATEGORIES, CATEGORY_IDS, type Category } from './data/categories.ts';
import { distToRing, makeProjection, pointInRing, signedArea, type Pt } from './geo.ts';

/** One establishment we have visited. Stored in src/data/places.json. */
export interface Place {
  /** URL-safe slug, unique. */
  id: string;
  name: string;
  category: Category;
  /** Our own words. Blank lines separate paragraphs. */
  description: string;
  address?: string;
  /** Date we first went, YYYY-MM-DD. */
  visited?: string;
  link?: string;
  /** Paths under public/, e.g. "photos/<id>/1.jpg". */
  photos?: string[];
  /** OSM building id, e.g. "w280365517". Places sharing a building share one mesh. */
  osmBuildingId: string;
  /** Outer ring as [lon, lat], counter-clockwise, no repeated closing point. */
  footprint: Array<[number, number]>;
  /** Meters. */
  height: number;
  /** Where the shop is, [lon, lat]; the awning is centered here. */
  storefront: [number, number];
  /** Wall index i (footprint[i] -> footprint[i + 1]) that carries the awning; nearest wall if omitted. */
  facadeEdge?: number;
  /** Awning and sign color like "#2f8a4f"; defaults to the category's color. */
  color?: string;
  /** Building look. Default: windows on every floor and a striped awning. */
  style?: PlaceStyle;
  /** Things around the building, all [lon, lat]. */
  lot?: PlaceLot;
}

export const PLACE_STYLES = ['fast-food'] as const;
export type PlaceStyle = (typeof PLACE_STYLES)[number];

export interface PlaceLot {
  /** Parking lot outlines (asphalt). */
  paved?: Array<Array<[number, number]>>;
  /** Walkway outlines (concrete), drawn over the asphalt. */
  walks?: Array<Array<[number, number]>>;
  /** Drive-thru lane centerline in driving order. */
  driveThru?: Array<[number, number]>;
  /** Base of a tall sign on a pole. */
  poleSign?: [number, number];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO = /^photos\/[a-z0-9-]+\/[\w.-]+\.(?:jpe?g|png|webp)$/i;

const isLonLat = (p: unknown): p is [number, number] =>
  Array.isArray(p) &&
  p.length === 2 &&
  typeof p[0] === 'number' &&
  typeof p[1] === 'number' &&
  p[0] > -74.1 &&
  p[0] < -73.8 &&
  p[1] > 40.65 &&
  p[1] < 40.8;

/** The color used for a place's awning and signs. */
export function placeColor(p: Pick<Place, 'category' | 'color'>): string {
  return p.color ?? CATEGORIES[p.category].color;
}

/** Returns a list of human-readable problems; empty means valid. */
export function validatePlaces(input: unknown): string[] {
  const errs: string[] = [];
  if (!Array.isArray(input)) return ['places.json must be an array'];
  const ids = new Set<string>();
  input.forEach((raw, i) => {
    const p = raw as Partial<Place>;
    const at = `place ${i} (${typeof p?.id === 'string' ? p.id : '?'})`;
    const err = (m: string) => errs.push(`${at}: ${m}`);
    if (!p || typeof p !== 'object') return err('not an object');
    if (typeof p.id !== 'string' || !SLUG.test(p.id)) err('id must be a lowercase slug like "sunny-cafe"');
    else if (ids.has(p.id)) err('duplicate id');
    else ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim()) err('name is required');
    if (!CATEGORY_IDS.includes(p.category as Category)) err(`category must be one of ${CATEGORY_IDS.join(', ')}`);
    if (typeof p.description !== 'string' || !p.description.trim()) err('description is required');
    if (p.address !== undefined && typeof p.address !== 'string') err('address must be text');
    if (p.visited !== undefined && (typeof p.visited !== 'string' || !DATE.test(p.visited) || Number.isNaN(Date.parse(p.visited))))
      err('visited must be a date like 2026-09-19');
    if (p.link !== undefined && (typeof p.link !== 'string' || !/^https?:\/\/\S+$/.test(p.link))) err('link must start with http:// or https://');
    if (p.photos !== undefined && (!Array.isArray(p.photos) || p.photos.some((ph) => typeof ph !== 'string' || !PHOTO.test(ph))))
      err('photos must be paths like "photos/<id>/1.jpg"');
    if (typeof p.osmBuildingId !== 'string' || !/^[wr]\d+$/.test(p.osmBuildingId)) err('osmBuildingId must look like "w123"');
    if (typeof p.height !== 'number' || !(p.height >= 2 && p.height <= 200)) err('height must be 2-200 meters');
    if (!Array.isArray(p.footprint) || p.footprint.length < 3 || !p.footprint.every(isLonLat)) {
      err('footprint must be 3+ [lon, lat] points near Sunnyside');
      return;
    }
    if (!isLonLat(p.storefront)) {
      err('storefront must be a [lon, lat] point');
      return;
    }
    const proj = makeProjection(p.footprint[0][0], p.footprint[0][1]);
    const ring: Pt[] = p.footprint.map(([lon, lat]) => proj.toLocal(lon, lat));
    if (signedArea(ring) <= 0) err('footprint must be counter-clockwise');
    const [sx, sy] = proj.toLocal(p.storefront[0], p.storefront[1]);
    if (!pointInRing(sx, sy, ring) && distToRing(sx, sy, ring) > 3) err('storefront must be inside the building (or within 3 m)');
    if (p.facadeEdge !== undefined && !(Number.isInteger(p.facadeEdge) && p.facadeEdge >= 0 && p.facadeEdge < p.footprint.length))
      err('facadeEdge must be a wall index');
    if (p.style !== undefined && !PLACE_STYLES.includes(p.style)) err(`style must be one of ${PLACE_STYLES.join(', ')}`);
    if (p.color !== undefined && (typeof p.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.color))) err('color must look like "#2f8a4f"');
    if (p.lot !== undefined) {
      const lot = p.lot as PlaceLot;
      const rings = (r: unknown) => r === undefined || (Array.isArray(r) && r.every((ring) => Array.isArray(ring) && ring.length >= 3 && ring.every(isLonLat)));
      if (typeof lot !== 'object' || lot === null) err('lot must be an object');
      else {
        if (!rings(lot.paved)) err('lot.paved must be outlines of 3+ [lon, lat] points');
        if (!rings(lot.walks)) err('lot.walks must be outlines of 3+ [lon, lat] points');
        if (lot.driveThru !== undefined && !(Array.isArray(lot.driveThru) && lot.driveThru.length >= 2 && lot.driveThru.every(isLonLat)))
          err('lot.driveThru must be 2+ [lon, lat] points');
        if (lot.poleSign !== undefined && !isLonLat(lot.poleSign)) err('lot.poleSign must be a [lon, lat] point');
      }
    }
  });
  return errs;
}
