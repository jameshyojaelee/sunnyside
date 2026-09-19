// Hand-tuned looks for parks we modeled after real life, keyed by OSM way id. Shapes come from
// OpenStreetMap; colors, line markings and wall positions come from satellite and street imagery
// (Google Maps, viewed 2026-09-19, as a visual reference only).

export type CourtLines = 'outline' | 'basketball' | 'half-basketball' | 'volleyball' | 'handball' | 'handball-pair';

export interface SurfaceLook {
  /** Surface paint. */
  color: string;
  /** Painted markings, drawn in white. Omit for a plain surface (rubber, dirt). */
  lines?: CourtLines;
  /** Second paint color for basketball keys. */
  accent?: string;
  /** A handball wall across the middle (two courts back to back), parallel to the short side. */
  midWall?: boolean;
  /** Volleyball net across the middle. */
  net?: boolean;
  /** Chain-link fence around it (dog runs). */
  fence?: boolean;
}

export interface ParkLook {
  /** Ground color of the whole park (paved playgrounds are asphalt or concrete, not grass). */
  ground: string;
  /** Trees grow only in a band this wide along the park's edge, plus over the `shaded` areas. */
  treeBand: number;
  /** Chance of a tree per 6 m cell in that band. */
  treeDensity: number;
  shaded: string[];
  /** Low iron fence around the park. */
  fence: string;
  /** Color of the play structures' roofs and slides. */
  playColor: string;
  surfaces: Record<string, SurfaceLook>;
}

export const PARK_LOOKS: Record<string, ParkLook> = {
  // Torsney/Lou Lodati Playground, Skillman Ave at 43rd St, next to Sunnyside Yard. Mostly dark
  // asphalt: a green-painted softball court on the 43rd St side, two sand-colored volleyball courts,
  // concrete handball courts with one tall wall between them, and Lou Lodati's shaded play area on
  // the west end, dark surfacing under a heavy tree canopy with red and green equipment.
  w143295853: {
    ground: '#5c5e60',
    treeBand: 7,
    treeDensity: 0.5,
    shaded: ['w495487050', 'w495486272'],
    fence: '#23272a',
    playColor: '#cf4a3f',
    surfaces: {
      w495486340: { color: '#3d8f72', lines: 'outline' },
      w495486494: { color: '#65686b', lines: 'half-basketball' },
      w495486817: { color: '#bdbab1', lines: 'handball-pair', midWall: true },
      w495487183: { color: '#c9a878', lines: 'volleyball', net: true },
      w495487556: { color: '#c9a878', lines: 'volleyball', net: true },
      w495487050: { color: '#54585a' },
      w495486272: { color: '#9e8a68', fence: true },
    },
  },
  // L/CPL Thomas P. Noonan Jr. Playground, Greenpoint Ave between 42nd and 43rd St. Light concrete
  // paving, a blue full basketball court with green keys, two gray half courts, back-to-back
  // handball courts on 47th Ave, a light-blue play area on 43rd St, a brick comfort station and a
  // tree-shaded dog run on the Greenpoint Ave side.
  w143928485: {
    ground: '#8e908e',
    treeBand: 8,
    treeDensity: 0.55,
    shaded: ['w1286139888'],
    fence: '#23272a',
    playColor: '#d9566f',
    surfaces: {
      w376372254: { color: '#3a7fc0', accent: '#2f9a6b', lines: 'basketball' },
      w376372249: { color: '#6a6d70', lines: 'half-basketball' },
      w376372259: { color: '#6a6d70', lines: 'half-basketball' },
      w376372243: { color: '#b5b3ab', lines: 'handball' },
      w376372257: { color: '#b5b3ab', lines: 'handball' },
      w376372252: { color: '#8fc2df' },
      w376372251: { color: '#8fc2df' },
      w1286139888: { color: '#9e8a68', fence: true },
    },
  },
};

/** The look for a surface (court, play area, dog run) by its OSM id, if one of our parks has it. */
export function surfaceLook(id: string): SurfaceLook | undefined {
  for (const park of Object.values(PARK_LOOKS)) if (park.surfaces[id]) return park.surfaces[id];
  return undefined;
}
