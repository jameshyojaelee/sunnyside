// Downloads raw map data for Sunnyside into data-raw/ (gitignored).
// Run once: `npm run fetch-data`, then `npm run build-data`. `npm run fetch-data -- parks` refetches
// only one step (base, parks, buildings, pois, trees), reusing the saved boundary.
// Sources: NYC Open Data (neighborhood boundary, street trees) and OpenStreetMap via Overpass.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data-raw/', import.meta.url);
const UA = 'sunnyside-neighborhood-map/0.1 (personal non-commercial project)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const MARGIN_M = 400;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${res.statusText} for ${url.slice(0, 120)}`);
    console.warn(`  ${res.status}; retrying in ${attempt * 10}s`);
    await new Promise((r) => setTimeout(r, attempt * 10_000));
  }
}

async function overpass(query: string): Promise<unknown> {
  let lastErr: unknown;
  for (const endpoint of OVERPASS) {
    try {
      return await getJson(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (e) {
      lastErr = e;
      console.warn(`  ${endpoint} failed: ${(e as Error).message}`);
    }
  }
  throw lastErr;
}

async function save(name: string, data: unknown) {
  await writeFile(new URL(name, OUT), JSON.stringify(data));
  console.log(`  wrote data-raw/${name}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const only = process.argv[2];
  const want = (step: string) => !only || only === step;

  let geom: { type: string; coordinates: number[][][][] };
  if (only) {
    geom = JSON.parse(await readFile(new URL('boundary.json', OUT), 'utf8'));
  } else {
    console.log('Boundary (NYC 2020 NTA QN0202 "Sunnyside")');
    const nta = (await getJson('https://data.cityofnewyork.us/resource/9nt8-h7nd.json?nta2020=QN0202')) as Array<{
      the_geom: { type: string; coordinates: number[][][][] };
    }>;
    if (nta.length !== 1 || nta[0].the_geom.type !== 'MultiPolygon') throw new Error('Unexpected boundary response');
    geom = nta[0].the_geom;
    await save('boundary.json', geom);
  }

  const pts = geom.coordinates.flat(2);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = MARGIN_M / 111_000;
  const dLon = MARGIN_M / (111_000 * Math.cos((midLat * Math.PI) / 180));
  const s = Math.min(...lats) - dLat;
  const n = Math.max(...lats) + dLat;
  const w = Math.min(...lons) - dLon;
  const e = Math.max(...lons) + dLon;
  const bbox = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  console.log(`  bbox with ${MARGIN_M} m margin: ${bbox}`);

  if (want('base')) {
    console.log('OSM streets, rail, land use');
    await save(
      'osm-base.json',
      await overpass(`[out:json][timeout:180][bbox:${bbox}];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|service|pedestrian)$"];
  way["railway"~"^(rail|subway|light_rail)$"];
  way["leisure"~"^(park|playground|garden|pitch|recreation_ground|dog_park)$"];
  way["landuse"~"^(cemetery|railway|grass|recreation_ground|village_green)$"];
  way["amenity"="grave_yard"];
  way["natural"~"^(water|wood)$"];
  relation["type"="multipolygon"]["leisure"~"^(park|playground|garden|pitch|recreation_ground)$"];
  relation["type"="multipolygon"]["landuse"~"^(cemetery|railway|grass|recreation_ground)$"];
  relation["type"="multipolygon"]["natural"~"^(water|wood)$"];
);
out geom;`),
    );
  }

  if (want('parks')) {
    console.log('OSM playground equipment and park structures');
    await save(
      'osm-parks.json',
      await overpass(`[out:json][timeout:120][bbox:${bbox}];
(
  nwr["playground"];
  node["man_made"="flagpole"];
  way["building"="toilets"];
  node["amenity"="toilets"];
);
out geom;`),
    );
  }

  if (want('buildings')) {
    console.log('OSM buildings (for Build mode only)');
    await save(
      'osm-buildings.json',
      await overpass(`[out:json][timeout:180][bbox:${bbox}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
);
out geom;`),
    );
  }

  if (want('pois')) {
    console.log('OSM named places (for Build mode search)');
    await save(
      'osm-pois.json',
      await overpass(`[out:json][timeout:120][bbox:${bbox}];
(
  nwr["name"]["shop"];
  nwr["name"]["amenity"];
  nwr["name"]["craft"];
  nwr["name"]["office"];
  nwr["name"]["tourism"];
  nwr["name"]["leisure"];
);
out center tags;`),
    );
  }

  if (!want('trees')) return;
  console.log('Street trees (NYC Parks Forestry Tree Points)');
  const where = `within_box(location,${n},${w},${s},${e}) AND tpstructure='Full'`;
  const trees = await getJson(
    `https://data.cityofnewyork.us/resource/hn5i-inap.json?$select=location,dbh,genusspecies&$limit=50000&$where=${encodeURIComponent(where)}`,
  );
  if (!Array.isArray(trees) || trees.length === 0) throw new Error('No trees returned');
  if (trees.length >= 50000) throw new Error('Tree query hit the row limit; paginate');
  await save('trees.json', trees);
  console.log(`  ${trees.length} trees`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
