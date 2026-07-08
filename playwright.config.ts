import { defineConfig } from '@playwright/test';

/**
 * Atlas E2E regression suite (PRD §12.3). Requires the dev stack running:
 *   pnpm dev   (server :5175 + client :5173)
 * Then:
 *   pnpm test:e2e            — full regression
 *   pnpm test:e2e --grep @fast   — skip generation-heavy specs
 *
 * Serial workers: specs share one server/db; tests self-clean via the
 * "[e2e]" title marker (teardown deletes those conversations).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.ATLAS_BASE ?? 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 1000 },
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
});
