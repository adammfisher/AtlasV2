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

  test('W2 search-grounded answer renders source links', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Search the web: what is the maximum AWS Lambda timeout? Cite your source.`);
    await composer(page).press('Enter');
    await waitIdle(page, 120_000);
    // a rendered citation = an anchor to the source domain in the answer body
    const links = page.locator('.chat-md a[href^="http"]');
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

  test('W4 PER-CHAT search toggle: off in chat A, chat B keeps web access', async ({ page }) => {
    // chat A: toggle off via the per-chat route
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/\/c\/[A-Za-z0-9_-]+/);
    const convA = /\/c\/([A-Za-z0-9_-]+)/.exec(page.url())?.[1];
    expect(convA).toBeTruthy();
    await api(`/conversations/${convA}/websearch`, { method: 'POST', body: JSON.stringify({ enabled: false }) });
    await composer(page).fill(`${MARK} Search the web for today's date in Tokyo. If you have no web access, reply exactly NO-WEB-TOOLS.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const bodyA = await page.locator('body').innerText();
    expect(bodyA).toMatch(/NO-WEB-TOOLS|no (web|internet|search) access|can'?t search/i);
    // chat B: untouched — web tools present (global default on)
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await composer(page).fill(`${MARK} Do you have web search tools available right now? Reply exactly WEB-OK if yes, NO-WEB-TOOLS if no.`);
    await composer(page).press('Enter');
    await pollBody(page, /WEB-OK/, 90_000);
  });
});
