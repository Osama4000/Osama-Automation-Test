import { defineConfig, devices } from '@playwright/test';

// Two projects:
// - "dev": interaction tests against the Vite dev server (the editor exposes a read-only state
//   hook only in development builds).
// - "prod": smoke test of the real production build served with the same security headers as
//   Vercel (vercel.json), to catch CSP problems before deployment.
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } };
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { acceptDownloads: true },
  projects: [
    { name: 'dev', testIgnore: /production\.spec/, use: { ...desktop, baseURL: 'http://localhost:5199' } },
    { name: 'prod', testMatch: /production\.spec/, use: { ...desktop, baseURL: 'http://localhost:5299' } },
  ],
  webServer: [
    { command: 'npx vite --port 5199 --strictPort', url: 'http://localhost:5199', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npx vite build && npx vite preview --port 5299 --strictPort', url: 'http://localhost:5299', reuseExistingServer: true, timeout: 180_000 },
  ],
});
