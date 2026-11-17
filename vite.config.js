import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js is one big chunk; that's expected for this site.
    chunkSizeWarningLimit: 1000,
  },
});
