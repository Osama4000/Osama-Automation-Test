import { defineConfig } from 'vite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';

// Serve pdf.js's bundled standard-font data from our own origin, so PDFs that use
// non-embedded fonts (Helvetica, Times… common in forms) render faithfully and offline,
// without fetching anything from a CDN.
function pdfjsStandardFonts() {
  const dir = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts');
  return {
    name: 'pdfjs-standard-fonts',
    configureServer(server) {
      server.middlewares.use('/pdfjs/standard_fonts/', (req, res, next) => {
        const file = join(dir, basename((req.url || '').split('?')[0]));
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const f of readdirSync(dir)) this.emitFile({ type: 'asset', fileName: `pdfjs/standard_fonts/${f}`, source: readFileSync(join(dir, f)) });
    },
  };
}

// The security headers live in vercel.json (what production serves). `vite preview` applies the
// same headers so they can be tested locally (npm run test:prod).
const vercelHeaders = Object.fromEntries(
  (JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers?.[0]?.headers || []).map(h => [h.key, h.value]),
);

export default defineConfig({
  plugins: [pdfjsStandardFonts()],
  preview: { headers: vercelHeaders },
  build: {
    // MuPDF's browser WASM loader uses top-level await.
    // Modern Chrome/Edge/Safari/Firefox support it, so do not transpile it to ES2020.
    target: 'esnext',
    // pdf.js + pdf-lib are inherently large; MuPDF is already split out and loaded on demand.
    chunkSizeWarningLimit: 1200,
  },
  optimizeDeps: {
    // MuPDF locates its .wasm next to its own JS file; pre-bundling would separate them and
    // break MuPDF in `npm run dev` (production builds are unaffected).
    exclude: ['mupdf'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
