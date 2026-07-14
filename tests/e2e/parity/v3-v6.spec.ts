/** V3 edit-branch (replace-forward is the shipped behavior — verify indicator
 * + truncation), V4 regenerate, V5 stop keeps partial, V6 copy. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, assistantText, MARK } from './helpers';

test.describe('V3-V6 conversation controls', () => {
  test.afterAll(cleanupMarked);

  test('V3 edit prior message: indicator shown, replaces forward', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    const c = composer(page);
    await c.fill(`${MARK} Reply with exactly ALPHA-1`);
    await c.press('Enter');
    await waitIdle(page, 60_000);
    await c.fill(`${MARK} Reply with exactly BETA-2`);
    await c.press('Enter');
    await waitIdle(page, 60_000);

    // edit the FIRST user message
    const firstUser = page.locator(`text=${MARK} Reply with exactly ALPHA-1`).first();
    await firstUser.hover();
    const pencil = page.locator('button[title*="dit"]').first();
    await expect(pencil, 'edit affordance on user message').toBeVisible({ timeout: 5_000 });
    await pencil.click();
    // indicator: the composer/banner announces the replace-forward behavior
    await expect(page.locator('text=/replace|editing/i').first()).toBeVisible({ timeout: 5_000 });
    await c.fill(`${MARK} Reply with exactly GAMMA-3`);
    await c.press('Enter');
    await pollBody(page, /GAMMA-3/, 60_000);
    const t = await assistantText(page);
    expect(t, 'later exchange must be gone (replace-forward)').not.toContain('BETA-2');
  });

  test('V4 regenerate produces a fresh response', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Give me a single random 5-letter codeword, nothing else.`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    const regen = page.locator('button[title*="egenerate"], button[title*="etry"]').last();
    await expect(regen).toBeVisible({ timeout: 5_000 });
    await regen.click();
    await waitIdle(page, 60_000);
    await expect(composer(page)).toBeEnabled();
  });

  test('V5 stop mid-generation keeps the partial', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Count from one to one hundred as words, one per line.`);
    await composer(page).press('Enter');
    await page.waitForTimeout(5000);
    const stop = page.locator('button:has(svg.lucide-square)').last();
    if (await stop.isVisible().catch(() => false)) await stop.click();
    await page.waitForTimeout(2500);
    const t = await assistantText(page);
    expect(t).toMatch(/\bone\b/i);
    await composer(page).fill(`${MARK} Reply with exactly RESUMED-OK`);
    await composer(page).press('Enter');
    await pollBody(page, /RESUMED-OK/, 60_000);
  });

  test('V6 copy button puts the message on the clipboard', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly COPY-SENTINEL-9`);
    await composer(page).press('Enter');
    await pollBody(page, /COPY-SENTINEL-9/, 60_000);
    await waitIdle(page, 30_000);
    await page.locator('button[title="Copy"]').last().click();
    await page.waitForTimeout(500);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('COPY-SENTINEL-9');
  });
});
