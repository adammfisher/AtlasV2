/** R10 extraction-status: while a 22MB deck uploads/extracts, the UI shows a
 * working state, and there is no path where the model answers about a file it
 * never read (send during upload must wait or exclude the file honestly). */
import { test, expect } from '@playwright/test';
import { composer, transcript, cleanupMarked, MARK, DFS_DECK } from './helpers';

test.describe('R10 extraction-status', () => {
  test.afterAll(cleanupMarked);

  test('upload shows progress; ask-during-upload never yields filename-only answers', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await page.locator('input[type="file"]').setInputFiles(DFS_DECK);

    // within the upload window some working affordance must exist
    // (spinner, progress, disabled send, or "uploading" text)
    await page.waitForTimeout(800);
    const during = await page.locator('body').innerText();
    const busyUi =
      /upload|extract|processing|indexing/i.test(during) ||
      (await page.locator('[class*="spin"], [class*="progress"], svg.animate-spin').count()) > 0;

    // try to send immediately — legitimate outcomes: composer blocked, or the
    // message goes without the file and the reply says it can't see it yet
    const c = composer(page);
    await c.fill(`${MARK} What is the title of slide 5? If you cannot read the file say CANNOT-READ-YET.`);
    await c.press('Enter');

    const t = await transcript(page);
    const answeredFromContent = /Tips\s*&\s*Shortcuts/i.test(t);
    const honestDefer = /CANNOT-READ-YET|can'?t (see|read|access)|no file|not.*attached|still.*upload/i.test(t);
    expect(
      answeredFromContent || honestDefer,
      `busyUi=${busyUi}; neither real content nor an honest defer appeared:\n${t.slice(-600)}`,
    ).toBe(true);
    // record the busy-UI observation in the assertion message for the matrix
    expect(busyUi, 'no visible working state during a 22MB upload (AMBER if content-honesty held)').toBe(true);
  });
});
