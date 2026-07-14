/** V1 context-management: an early fact must survive 30+ turns via the rolling
 * summary (context.ts: RECENT_COUNT=12, SUMMARY_TRIGGER=6). */
import { test } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, MARK } from './helpers';

test.describe('V1 context-management', () => {
  test.afterAll(cleanupMarked);
  test.setTimeout(900_000);

  test('early fact recalled after 30 turns (summary, not window)', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    const c = composer(page);
    await c.fill(`${MARK} Important context for later: the launch codename is VERMILION-KITE and the launch date is October 9. Reply only OK.`);
    await c.press('Enter');
    await waitIdle(page, 60_000);
    for (let i = 1; i <= 30; i++) {
      await c.fill(`${MARK} Filler turn ${i}. Reply with exactly OK-${i}.`);
      await c.press('Enter');
      await waitIdle(page, 60_000);
    }
    await c.fill(`${MARK} Without me repeating it: what are the launch codename and date from the start of this conversation?`);
    await c.press('Enter');
    await pollBody(page, /VERMILION-KITE/, 90_000);
    await pollBody(page, /October 9/, 30_000);
  });
});
