/**
 * Shared Playwright fixtures for the ui-mocked and live-smoke projects.
 *
 * - Runs as the isolated `e2etest` account (storage state from global-setup).
 * - Console/pageerror sentinels: any uncaught page error or console.error
 *   fails the test (TESTPLAN §4). Allowlist is empty; additions must be
 *   justified in TESTPLAN.md.
 * - `freshConv` creates a marked conversation via the API and navigates to it.
 */
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createConv, cleanupE2E, type Conv } from './axiom-api.js';

/** console.error allowlist — EMPTY. Add entries only with a TESTPLAN.md §4 justification. */
const CONSOLE_ERROR_ALLOWLIST: RegExp[] = [];

export interface Sentinel {
  errors: string[];
  assertClean: () => void;
}

export const axiomTest = base.extend<{ sentinel: Sentinel; freshConv: Conv }>({
  storageState: 'tests/e2e/.auth-state-e2e.json',

  sentinel: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (CONSOLE_ERROR_ALLOWLIST.some((re) => re.test(text))) return;
        errors.push(`console.error: ${text}`);
      });
      const sentinel: Sentinel = {
        errors,
        assertClean: () => expect(errors, `page errors captured:\n${errors.join('\n')}`).toHaveLength(0),
      };
      await use(sentinel);
      // auto-assert at teardown so every test gets the sentinel for free
      sentinel.assertClean();
    },
    { auto: true },
  ],

  freshConv: async ({ page: _page }, use) => {
    const conv = await createConv();
    await use(conv);
    await cleanupE2E().catch(() => undefined);
  },
});

export { expect };

/** Navigate straight into a conversation (deep link) and wait for the app shell. */
export async function gotoConv(page: Page, convId: string): Promise<void> {
  await page.goto(`/c/${convId}`);
  await page.getByTestId('composer').waitFor();
}
