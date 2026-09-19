import { defineConfig } from 'vite';
import { buildModePlugin } from './vite-plugin-build-mode.ts';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/sunnyside/"); local dev serves from "/".
// The map data lives in public/, so its URL never changes between deploys and browsers happily
// serve a stale copy to new code. This stamp is appended to the request to keep them in step.
const buildId = Date.now().toString(36);

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  server: { port: 5173, strictPort: true },
  // three.js alone is ~550 KB minified; one bundle is fine for this site.
  build: { chunkSizeWarningLimit: 800 },
  plugins: [buildModePlugin()],
});
