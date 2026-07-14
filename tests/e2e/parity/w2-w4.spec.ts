/** W2 citations @red (no citation rendering exists), W3 URL fetch grounding,
 * W4 search toggle (exists but GLOBAL — spec wants per-chat; audit records). */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, api, MARK } from './helpers';

test.describe('W2-W4 web UX', () => {
  test.afterAll(cleanupMarked);
  test.afterEach(async () => {
    // never leave search disabled for later specs
    await api('/settings', { method: 'PATCH', body: JSON.stringify({ webSearchEnabled: '1' }) }).catch(() => undefined);
  });

  test('@red W2 search-grounded answer renders source links', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Search the web: what is the maximum AWS Lambda timeout? Cite your source.`);
    await composer(page).press('Enter');
    await waitIdle(page, 120_000);
    // a rendered citation = an anchor to the source domain in the answer body
    const links = page.locator('main a[href^="http"], [class*="message"] a[href^="http"]');
    expect(await links.count(), 'no clickable source citations rendered').toBeGreaterThan(0);
  });

  test('W3 pasted URL is fetched and grounds the answer', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Read https://example.com and tell me the exact heading text on that page.`);
    await composer(page).press('Enter');
    await pollBody(page, /Example Domain/i, 120_000);
  });

  test('W4 search toggle off removes the tools (global-scope noted)', async ({ page }) => {
    await api('/settings', { method: 'PATCH', body: JSON.stringify({ webSearchEnabled: '0' }) });
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Search the web for today's date in Tokyo. If you have no web access, reply exactly NO-WEB-TOOLS.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/NO-WEB-TOOLS|no (web|internet|search) access|can'?t search/i);
    // and no web tool chip may appear
    expect(body).not.toMatch(/web_search · web/);
  });
});
