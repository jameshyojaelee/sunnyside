// Road classification shared by the data build step and tests.

export interface RoadStyle {
  /** Curb-to-curb width in meters. */
  w: number;
  /** Sidewalk width on each side in meters (0 = none). */
  sw: number;
  /** Draw white edge lines. */
  lines: boolean;
}

const SKIP_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);

/** Returns null for ways we don't draw. Widths include NYC parking lanes, which OSM `lanes` omits. */
export function roadStyle(tags: Record<string, string>): RoadStyle | null {
  const hw = tags.highway;
  if (!hw || tags.area === 'yes' || tags.tunnel === 'yes' || tags.tunnel === 'building_passage') return null;
  const lanes = Number.parseInt(tags.lanes ?? '', 10);
  const L = Number.isFinite(lanes) && lanes > 0 ? lanes : undefined;
  const oneway = tags.oneway === 'yes' || tags.oneway === '-1' || tags.junction === 'roundabout';
  switch (hw) {
    case 'motorway':
    case 'trunk':
      return { w: (L ?? (oneway ? 3 : 6)) * 3.6 + 1.5, sw: 0.8, lines: true };
    case 'motorway_link':
    case 'trunk_link':
    case 'primary_link':
    case 'secondary_link':
    case 'tertiary_link':
      return { w: (L ?? 1) * 3.6 + 1.2, sw: 0.6, lines: true };
    case 'primary':
    case 'secondary':
      return { w: (L ?? (oneway ? 3 : 2)) * 3.3 + (oneway ? 1.0 : 4.8), sw: 3, lines: true };
    case 'tertiary':
      return { w: oneway ? (L ?? 1) * 3.3 + 2.4 : (L ?? 2) * 3.3 + 4.8, sw: 3, lines: true };
    case 'residential':
    case 'unclassified':
    case 'living_street':
      return { w: oneway ? Math.max(8.5, (L ?? 1) * 3.3 + 4.8) : Math.max(10.5, (L ?? 2) * 3.3 + 4.8), sw: 3, lines: true };
    case 'service':
      if (SKIP_SERVICE.has(tags.service ?? '')) return null;
      return { w: tags.service === 'alley' ? 4 : 5, sw: 0, lines: false };
    case 'pedestrian':
      return { w: 0, sw: 3, lines: false };
    default:
      return null;
  }
}

/** Draw-order group: tunnels are skipped by roadStyle; bridges stack above ground roads. */
export function roadLayer(tags: Record<string, string>): number {
  const l = Number.parseInt(tags.layer ?? '', 10);
  if (Number.isFinite(l)) return Math.max(0, l);
  return tags.bridge && tags.bridge !== 'no' ? 1 : 0;
}
