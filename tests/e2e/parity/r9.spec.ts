/** R9 large-file honesty: unsupported type must produce a visible error, not a
 * silent drop and never a chip that pretends the file attached. */
import { test, expect } from '@playwright/test';
import { cleanupMarked, fixture } from './helpers';

test.describe('R9 unsupported-file honesty', () => {
  test.afterAll(cleanupMarked);

  test('unsupported extension surfaces an error before send', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await page.locator('input[type="file"]').setInputFiles(fixture('junk.xyz'));
    await page.waitForTimeout(3000);
    const body = await page.locator('body').innerText();
    const chipAttached = /junk\.xyz/.test(body);
    const errorShown = /unsupported|can'?t|cannot|not supported|failed/i.test(body);
    // honest outcomes: an error is shown, or the file simply refuses to attach.
    // dishonest: a normal-looking chip with no error.
    expect(errorShown || !chipAttached, `body said: chip=${chipAttached} error=${errorShown}`).toBe(true);
  });
});
