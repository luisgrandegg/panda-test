import { defineConfig, devices } from '@playwright/test';

// The fold check depends on screen size, so every page runs on a desktop and a mobile viewport.
// Limit a page to one of them with "projects" in the pages config.
export default defineConfig({
  testDir: './tests',
  testIgnore: process.env.DISCOVER ? undefined : '**/discover.spec.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // results.json feeds scripts/build-report.mjs (the executive report).
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    locale: 'es-ES',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
