# Sunnyside, NY: a Sims 1 style neighborhood map

## Context
The goal is a public website that introduces Sunnyside, Queens as a Sims 1 "neighborhood screen": an aerial, fixed-angle view of grass, real streets and simple trees. It starts **empty**. Each establishment we have personally visited (about 20 to start, added over time) appears as a simple building at its real location, and clicking it opens our description. The repo is empty (no commits), so this is a new project.

Decisions confirmed with the user:
- **Look:** the Sims 1 neighborhood screen from the reference screenshot: textured green grass, grey roads with white edge lines, simple conifer and round trees, round blue icon buttons. Elements stay simple.
- **Streets:** real Sunnyside geometry, not approximated.
- **Buildings:** a place appears as its **real OpenStreetMap (OSM) building outline, simplified and raised to its real height**, with rows of windows and a colored awning and sign on the wall facing the street.
- **Adding places:** a Sims-style **Build mode that only exists when the site runs locally** (`npm run dev`). You click the building, fill in a form and save; one command publishes. The live site is look-only: no backend, no login.

## Verified data sources (live queries, 2026-09-19)
| Layer | Source | Check result |
|---|---|---|
| Streets, parks, rail, 7 train viaduct | OSM via Overpass API (ODbL, credit required) | 446 vehicle roads in the core box (Queens Blvd = one-way `primary` lanes with `tertiary` service roads; 289/446 have `lanes`, none have `width`, 12 are bridges); 15 named parks; 321 railway ways; viaduct = `IRT Flushing Line`, `bridge=yes layer=2` |
| Building outlines (Build mode only, never shipped to visitors) | OSM | 5,563 buildings, 98.5% with `height`; a lookup at 46th St & Queens Blvd returned 13 real outlines with heights and addresses (e.g. `46-10 Queens Boulevard`, 5.2 m) |
| Trees | NYC Parks "Forestry Tree Points" `hn5i-inap` (updated 2026-09-09) | 4,829 standing (`tpstructure='Full'`) trees in the core box, with trunk size (`dbh`) |
| Neighborhood edge | NYC 2020 neighborhood boundaries `9nt8-h7nd`, `nta2020='QN0202'` ("Sunnyside") | MultiPolygon, about 3.06 x 2.69 km |

Google and Apple Maps are excluded: their terms forbid extracting their geometry to redraw it in our own style.

## Stack
- Vite + TypeScript + **Three.js** (WebGL, orthographic camera), no UI framework, `polygon-clipping` for shadow outlines, Vitest, GitHub Pages.
- Latest versions on 2026-09-19: three 0.186.0, vite 8.3.0, typescript 7.0.2, vitest 5.0.1, polygon-clipping 0.15.7. Fall back to TypeScript 5.x if the new native TS 7 compiler causes tooling friction [Unverified].
- **Why 3D and not 2D canvas:** an independent review and I compared them. The deciding factor is overlap. Places cluster on Queens Blvd, right beside the elevated 7 train, and must look right in 4 rotations. In 2D, which object hides which has to be sorted by hand, and that breaks for long or L-shaped objects. A depth buffer handles it automatically. WebGL is also the cheaper option for about 10k trees on phones.

## Files (new)
```
scripts/fetch-map-data.ts   one-off: Overpass + NYC Open Data -> public/data/sunnyside.json, dev-data/buildings.json
scripts/publish.ts          validate + test + build + commit + push (asks y/n first)
public/data/sunnyside.json  roads, landuse, parks, rail, bridges, viaduct, trees, boundary (local meters, simplified)
dev-data/buildings.json     all real building outlines + heights + addresses (Build mode only; not under public/)
src/data/places.json        our places; starts as []
src/data/categories.ts      category -> awning color, sign icon
src/geo.ts                  lat/lon <-> local meters, point-in-polygon, simplify, winding fix
src/camera.ts               orthographic camera: pan/zoom/4 rotations, fit, glide-to
src/input.ts                own Pointer Events controller (drag, pinch, wheel, tap vs drag, keys)
src/render/ground.ts        grass shader plane, landuse meshes, layered road strips, raised bridges, rail yard
src/render/trees.ts         InstancedMesh billboards from a procedural canvas atlas + blob shadows
src/render/buildings.ts     extruded place buildings, window texture, awning/sign, shadow polygon
src/render/viaduct.ts       elevated 7 train deck + pillars
src/render/markers.ts       floating green diamonds, hover outline
src/ui/*.ts                 top buttons, place card, places list, intro/about, build-mode panel
vite-plugin-build-mode.ts   dev-only endpoints (apply: 'serve'), writes places.json + photos
.github/workflows/deploy.yml
```

## Data pipeline (`npm run fetch-data`, run once, output committed)
1. Boundary QN0202 -> bbox + 400 m margin.
2. Overpass: vehicle `highway` types (+ `service` except `parking_aisle`/`driveway`), `leisure` parks and playgrounds, `landuse` (cemetery, railway, grass), `railway` lines, viaduct. Skip footways. Split `bridge=*`/`layer>=1` roads into their own list.
3. Trees: `hn5i-inap`, `tpstructure='Full'`, keep position + `dbh`. **Push any tree that lands on asphalt** (given our road widths) out to the curb + 0.5 m.
4. Project to local meters (equirectangular around the boundary center; error well under 1% at this size), simplify (Douglas-Peucker about 0.5 m), round to 0.1 m. Road width = `lanes` x 3.3 m + 1 m, with a per-type fallback. Compute the dominant street-grid angle (histogram of residential segment bearings mod 90 deg) for the default camera.
5. Sanity asserts: road count > 400, tree count > 4,000, valid boundary. Expected size is under about 600 KB [Estimate].

## Rendering (Three.js)
- **Camera:** `OrthographicCamera`, elevation 30 deg (a ground square projects 2:1, as in the Sims), azimuth = grid angle + 45 deg + k x 90 deg, so Sunnyside's streets run diagonally like the screenshot while their geography stays true. Zoom = frustum size. Rotation animates between 90 deg steps. Pixel ratio is capped at 2; the scene redraws only when something moves (plus the diamond bob); a `webglcontextlost` handler reloads the scene.
- **Ground** (flat, drawn in fixed `renderOrder` with depth writes off, then everything 3D is depth-tested on top):
  1. A big plane with a grass shader: multi-octave noise in a few Sims greens, darker and denser outside the boundary, where a forest fringe fades the map edge like the game.
  2. Landuse meshes (`ShapeGeometry`): park green, tan playgrounds, cemetery, gravel rail yard + thin track strips.
  3. **Roads in 4 layers:** sidewalk strips (width w + 6 m) -> asphalt (w) -> white (w - 1.4 m) -> asphalt (w - 1.8 m). Each strip is a flat quad per segment plus a disc at each vertex for round joins. Every layer is one color, so overlaps are invisible. Intersections merge cleanly and the white edge lines stop at junctions without any special code. It stays sharp at any zoom, with no textures.
  4. Bridges are separate raised strips (`layer` x 5 m), so they don't fuse with the roads beneath.
- **Trees:** one `InstancedMesh` of camera-facing quads that re-face on rotation, from a canvas-drawn atlas (round deciduous for street trees, sized by `dbh`; conifers scattered in parks, the cemetery and the forest fringe). `alphaTest` gives correct depth. A second instanced mesh draws the blob shadows. Seeded scatter never lands on roads, and trees within 2 m of a place's footprint are hidden.
- **Place buildings:**
  - The real outline is cleaned (fixed winding, self-intersections dropped), simplified to about 0.75 m and extruded to `height` (fallback `building:levels` x 3 m, else 9 m).
  - Walls are one quad per edge with UVs in meters, so a small repeating canvas window texture gives window rows every 3.2 m. The roof is a `ShapeGeometry` (handles L-shapes and courtyards), lighter with a parapet edge. Faces are lit by a fixed Sims-like sun.
  - An awning plus sign board sits on the **storefront wall**: the wall nearest the point you clicked in Build mode, tie-broken by matching `addr:street` to the nearest named road. It is centred on the click, with a manual wall override in Build mode.
  - The shadow is computed once per building: the union (`polygon-clipping`) of the footprint swept along the sun vector, drawn as one translucent ground mesh, so it never darkens twice.
  - Two places in one building share one mesh with two awnings; a click picks the nearest awning.
- **Viaduct:** a deck strip at about 8 m following the OSM line, with pillars every about 25 m and a ground shadow strip.
- **Picking:** a raycast against place meshes (60 at most); in Build mode, a ray hits the ground plane, then point-in-polygon against a grid index of the 5.5k outlines.

## Interaction and UI
- Drag to pan, wheel/pinch to zoom (clamped, anchored at the cursor or pinch center), Q/E or a button to rotate 90 deg, a Home button to fit the map. Mouse: hover shows the outline and the name label. Touch: tap opens the place directly. `touch-action: none` on the canvas.
- **Names are HTML, never text painted on walls.** In 2 of 4 rotations an awning faces away from the camera, and wall text is skewed and unreadable anyway. So every place has a floating green diamond and a hover/tap name label, and the card shows the name.
- Round blue buttons at the top (as in the screenshot): Places list, Zoom +/-, Rotate, Home, About, plus Build (dev only).
- Place card (Sims-style rounded blue panel; bottom sheet on phones): name, category, our description, address, date first visited, link, 0-4 photos.
- Empty state: an intro card ("Places appear here as we visit them") and a "0 places so far" counter. The places list is a real HTML list, so it also works with the keyboard.
- About: our intro text (you supply it), plus the credit "© OpenStreetMap contributors" (required), NYC Parks tree data and NYC Planning boundary, and "Inspired by The Sims; not affiliated with EA/Maxis". All art is procedural; no EA fonts, sprites or sounds.

## Build mode (local only)
`vite-plugin-build-mode.ts` uses `apply: 'serve'`, so it is absent from the production build.
1. Build button -> faint outlines of every real building (from `dev-data/buildings.json`) and street-name tooltips appear.
2. Optional address search: first the local OSM address index, then a Nominatim fallback (at most 1 request/s, with an identifying user-agent).
3. Click the building at the storefront spot -> it highlights and a ghost block rises. The form is pre-filled with the address and height; you can adjust the height and the storefront wall.
4. Save -> `POST /__build/places` validates and writes `src/data/places.json` (stable ordering, pretty-printed). Photos are downscaled in the browser to at most 1600 px JPEG before upload, which also strips GPS/EXIF metadata, and saved to `public/photos/<id>/`.
5. Edit, move the storefront, delete.
6. `npm run publish` -> schema check + tests + build, shows the diff, asks y/n, then commits and pushes. GitHub Actions deploys to Pages.

Your list of about 20 places: you add them yourselves in Build mode as planned. Or you send me the names/addresses and notes, and I add them through the same `/__build/places` code path, so both routes produce identical data.

`places.json` entry: `{id, name, category, description, address, visited?, link?, photos?[], osmBuildingId, footprint:[[lon,lat]...], height, storefront:[lon,lat], facadeEdge?}`.

## Order of work (riskiest first, two visual checkpoints with you)
0. Save this plan as `docs/superpowers/specs/2026-09-19-sunnyside-sims-map-design.md` in the first commit.
1. Scaffold; `geo.ts` + tests; **touch/camera controller on an empty green plane** (tested on your phone via `vite --host`); data pipeline.
2. Ground + roads + bridges + trees on the empty map. First look at a 600 m crop around Queens Blvd and 39th St (dual carriageways, service roads, bridges), then the full map. **Checkpoint 1: screenshot for your approval of the look and the map edge** (the official boundary may include areas you don't consider Sunnyside).
3. Buildings using test fixtures (a real L-shape, a real 6-story corner block shared by two shops), shadows, picking, place card. Phone performance check.
4. Build mode + publish script. **Checkpoint 2: you add your first real place end to end.**
5. UI chrome, places list, about, mobile layout, viaduct.
6. Deploy. **This is gated:** creating the GitHub repo is outward-facing, so I confirm public vs private first (free GitHub Pages needs a public repo [Unverified: recalled, check `gh` at that step]).

## Verification
- `npx vitest run` covers:
  - projection round trip < 1 cm; the 2:1 ratio of a projected ground square; camera screen<->ground round trip in all 4 rotations;
  - point-in-polygon, simplification, winding fix; outward wall normals for CW and CCW footprints;
  - shadow union covering the footprint; trees removed from asphalt;
  - storefront wall choice on a corner-lot fixture;
  - `places.json` schema (required fields, storefront inside footprint, inside boundary + margin).
- `npm run build && npx vite preview`: the base path works; `grep -r "__build" dist/` returns nothing (Build mode is not shipped).
- Claude in Chrome:
  - screenshots at 1440x900 and 390x844 against the reference screenshot; zero console errors;
  - hover/click/rotate (L-shape and viaduct overlap correct in all 4 rotations)/pinch;
  - the Build mode add -> file written -> building appears -> delete flow.
- Performance: Chrome performance panel while panning zoomed out, with 4x CPU throttle, frame time <= 16 ms; plus a real-phone check over `vite --host`.

## Risks
- **The look is subjective** -> mitigated by Checkpoint 1 before building everything else.
- **Queens Blvd complexity** (dual carriageways, service roads, medians, bridges fusing) -> the 600 m crop is the first render; hand-tune widths there.
- **Phone GPU/memory** -> DPR cap, redraw only when needed, thin trees when zoomed far out; measured in step 3.
- **OSM outline or height is wrong for a building** -> Build mode overrides for height and storefront wall.
- **Overpass/Nominatim rate limits** -> data is fetched once and committed; Nominatim is only a local fallback.
