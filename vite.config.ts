import { defineConfig } from 'vite';
import { buildModePlugin } from './vite-plugin-build-mode.ts';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/sunnyside/"); local dev serves from "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173, strictPort: true },
  // three.js alone is ~550 KB minified; one bundle is fine for this site.
  build: { chunkSizeWarningLimit: 800 },
  plugins: [buildModePlugin()],
});
