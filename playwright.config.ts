import { defineConfig } from '@playwright/test';

/**
 * Atlas E2E suites. Three projects (TESTPLAN.md §4):
 *
 *   ui-mocked     — frontend against RECORDED SSE fixtures (tests/fixtures/sse).
 *                   Fast, deterministic, no backend model calls. Needs the dev
 *                   stack for static assets + REST reads unless a spec mocks them.
 *   live-smoke    — full stack, real Bedrock (Nova 2 Lite chat / Haiku office).
 *                   Structural assertions only, serial (shares server + data).
 *   parity-legacy — the pre-existing parity + top-level specs, untouched.
 *
 * Requires the dev stack running:  pnpm dev   (server :5175 + client :5173)
 *   pnpm test:ui     — ui-mocked
 *   pnpm test:live   — live-smoke
 *   pnpm test:e2e    — everything
 *
 * Serial workers on live projects: specs share one server/db; tests self-clean
 * via the "[e2e]" title marker (teardown deletes those conversations).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: {
    baseURL: process.env.ATLAS_BASE ?? 'http://127.0.0.1:5173',
    storageState: 'tests/e2e/.auth-state.json',
    viewport: { width: 1600, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'ui-mocked',
      testDir: 'tests/e2e/ui-mocked',
      timeout: 300_000, // A0-2 replays a 3-minute stream
    },
    {
      name: 'live-smoke',
      testDir: 'tests/e2e/live-smoke',
    },
    {
      name: 'parity-legacy',
      testDir: 'tests/e2e',
      testIgnore: ['**/ui-mocked/**', '**/live-smoke/**'],
    },
  ],
});
