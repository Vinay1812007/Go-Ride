import { defineConfig, devices } from '@playwright/test';

// GoRide end-to-end smoke tests.
//
// These are HEALTH CHECKS, not full coverage. They visit each live Pages
// project's public surface (auth page + developer docs + public tracking
// with a bad token) and assert the app renders + expected copy is present.
// Anything that needs a signed-in session is guarded behind a
// GORIDE_E2E_EMAIL / GORIDE_E2E_PASSWORD pair — skipped when unset so
// running locally without creds still passes.
//
// Local: `cd tests && npm i && npx playwright install chromium && npm test`
// CI:    Actions → "E2E smoke" → Run workflow (manual dispatch only)

const BASE_CUSTOMER = process.env.GORIDE_URL_CUSTOMER ?? 'https://goride-web.pages.dev';
const BASE_CAPTAIN  = process.env.GORIDE_URL_CAPTAIN  ?? 'https://goride-captain.pages.dev';
const BASE_ADMIN    = process.env.GORIDE_URL_ADMIN    ?? 'https://goride-admin.pages.dev';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'customer',
      use: { ...devices['Pixel 7'], baseURL: BASE_CUSTOMER },
    },
    {
      name: 'captain',
      use: { ...devices['Pixel 7'], baseURL: BASE_CAPTAIN },
    },
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], baseURL: BASE_ADMIN },
    },
  ],
});
