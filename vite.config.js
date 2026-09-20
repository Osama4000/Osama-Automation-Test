import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // MuPDF's browser WASM loader uses top-level await.
    // Modern Chrome/Edge/Safari/Firefox support it, so do not transpile it to ES2020.
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
});
