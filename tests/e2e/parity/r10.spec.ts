/** R10 extraction-status: while a 22MB deck uploads/extracts, the UI shows a
 * working state; a send during upload QUEUES (visible banner) and fires when
 * the upload lands — never a silent drop, never an answer about an unread file. */
import { test, expect } from '@playwright/test';
import { composer, pollBody, cleanupMarked, MARK, DFS_DECK } from './helpers';

test.describe('R10 extraction-status', () => {
  test.afterAll(cleanupMarked);
  test.setTimeout(420_000);

  test('upload shows progress; ask-during-upload queues and answers from content', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await page.locator('input[type="file"]').setInputFiles(DFS_DECK);

    // a working affordance must exist during the upload window
    await page.waitForTimeout(600);
    const during = await page.locator('body').innerText();
    const busyUi =
      /upload|extract|processing|indexing/i.test(during) ||
      (await page.locator('[class*="spin"], [class*="progress"], svg.animate-spin').count()) > 0;
    expect(busyUi, 'visible working state during a 22MB upload').toBe(true);

    // send immediately — must queue with a visible banner, not vanish
    const c = composer(page);
    await c.fill(`${MARK} What is the title of slide 5? If you cannot read the file say CANNOT-READ-YET.`);
    await c.press('Enter');
    const banner = page.locator('text=/sends when the file is ready|uploading/i');
    expect(await banner.count(), 'queued-send banner visible').toBeGreaterThan(0);

    // ...and the queued message fires after the upload, answered from content
    await pollBody(page, /Tips\s*&\s*Shortcuts|CANNOT-READ-YET/i, 300_000);
    const t = await page.locator('body').innerText();
    expect(/Tips\s*&\s*Shortcuts/i.test(t), 'answered from real file content').toBe(true);
  });
});
