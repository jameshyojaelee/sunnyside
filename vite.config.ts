import { defineConfig } from 'vite';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/sunnyside/"); local dev serves from "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173, strictPort: true },
});
