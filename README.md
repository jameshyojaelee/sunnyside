# Sunnyside, Queens

A Sims 1 style neighborhood map of Sunnyside, NY. Real streets, an empty neighborhood, and a building for each place we have visited.

Live: https://jameshyojaelee.github.io/sunnyside/

## Adding a place
1. `npm run dev` and open http://127.0.0.1:5173
2. Click the hammer (Build mode), search for the shop or click its building, fill in the form, Save.
3. `npm run publish-places` checks everything, shows what changed, and (after you confirm) commits and pushes. GitHub Actions redeploys the site in about a minute.

## Commands
- `npm run dev`: local site at http://127.0.0.1:5173 (Build mode lives here only)
- `npm test`, `npm run typecheck`, `npm run build`
- `npm run fetch-data` then `npm run build-data`: refresh map data from the sources below

## Data and credits
- Streets, parks, rail, buildings and named places: © OpenStreetMap contributors, available under the Open Database License (ODbL). The files in `public/data/` and `dev-data/` are derived from OpenStreetMap and are also ODbL.
- Street trees: NYC Parks "Forestry Tree Points", NYC Open Data.
- Neighborhood boundary: NYC Department of City Planning, 2020 Neighborhood Tabulation Areas, NYC Open Data.

Inspired by The Sims (1999/2000). Not affiliated with Electronic Arts or Maxis. All art is drawn in code.
