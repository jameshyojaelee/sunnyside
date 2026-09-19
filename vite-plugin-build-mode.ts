// Dev-only endpoints behind Build mode. `apply: 'serve'` keeps all of this out of production builds.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { validatePlaces, type Place } from './src/places.ts';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PLACES = path.join(ROOT, 'src/data/places.json');
const PHOTOS = path.join(ROOT, 'public/photos');
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PHOTO_NAME = /^[\w-]+\.(?:jpe?g|png|webp)$/i;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const UA = 'sunnyside-neighborhood-map/0.1 (personal non-commercial project; build mode)';

const isLocal = (req: IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readPlaces(): Promise<Place[]> {
  return JSON.parse(await readFile(PLACES, 'utf8')) as Place[];
}

async function writePlaces(places: Place[]) {
  const sorted = places.slice().sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(PLACES, JSON.stringify(sorted, null, 2) + '\n');
}

let lastGeocode = 0;

export function buildModePlugin(): Plugin {
  return {
    name: 'sunnyside-build-mode',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://local');
        if (!url.pathname.startsWith('/__build/')) return next();
        if (!isLocal(req)) return send(res, 403, { error: 'Build mode only works on this computer.' });
        try {
          const route = url.pathname.slice('/__build/'.length);
          if (req.method === 'GET' && (route === 'buildings' || route === 'pois')) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(await readFile(path.join(ROOT, `dev-data/${route}.json`)));
          }
          if (req.method === 'POST' && route === 'places') {
            const place = JSON.parse((await body(req, 1024 * 1024)).toString('utf8')) as Place;
            const places = (await readPlaces()).filter((p) => p.id !== place.id);
            places.push(place);
            const errors = validatePlaces(places);
            if (errors.length) return send(res, 400, { error: errors.join('\n') });
            await writePlaces(places);
            // Drop photo files this place no longer uses (removed while editing).
            const keep = new Set((place.photos ?? []).map((ph) => path.basename(ph)));
            const dir = path.join(PHOTOS, place.id);
            for (const f of await readdir(dir).catch(() => [] as string[])) if (!keep.has(f)) await rm(path.join(dir, f), { force: true });
            return send(res, 200, { ok: true });
          }
          const del = route.match(/^places\/([a-z0-9-]+)$/);
          if (req.method === 'DELETE' && del && SLUG.test(del[1])) {
            const places = await readPlaces();
            if (!places.some((p) => p.id === del[1])) return send(res, 404, { error: 'No such place' });
            await writePlaces(places.filter((p) => p.id !== del[1]));
            await rm(path.join(PHOTOS, del[1]), { recursive: true, force: true });
            return send(res, 200, { ok: true });
          }
          const photo = route.match(/^photos\/([a-z0-9-]+)\/([^/]+)$/);
          if (req.method === 'POST' && photo && SLUG.test(photo[1]) && PHOTO_NAME.test(photo[2])) {
            const data = await body(req, MAX_PHOTO_BYTES);
            const dir = path.join(PHOTOS, photo[1]);
            await mkdir(dir, { recursive: true });
            await writeFile(path.join(dir, photo[2]), data);
            return send(res, 200, { path: `photos/${photo[1]}/${photo[2]}` });
          }
          if (req.method === 'GET' && route === 'geocode') {
            // Nominatim usage policy: at most one request per second, identify the app.
            const wait = 1100 - (Date.now() - lastGeocode);
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            lastGeocode = Date.now();
            const q = new URLSearchParams({
              q: url.searchParams.get('q') ?? '',
              format: 'jsonv2',
              limit: '5',
              viewbox: '-73.951,40.754,-73.905,40.722',
              bounded: '1',
            });
            const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { 'User-Agent': UA } });
            if (!r.ok) return send(res, 502, { error: `Address search failed (${r.status})` });
            const hits = (await r.json()) as Array<{ display_name: string; lat: string; lon: string }>;
            return send(res, 200, hits.map((h) => ({ name: h.display_name, lon: +h.lon, lat: +h.lat })));
          }
          return send(res, 404, { error: 'Unknown build route' });
        } catch (e) {
          return send(res, 500, { error: (e as Error).message });
        }
      });
    },
  };
}
