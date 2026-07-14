/** V2 thinking-persist @red: reasoning must survive reload as a collapsible
 * block. Code audit: never persisted (chat.ts persists only text+toolCalls). */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, cleanupMarked, MARK } from './helpers';

test.describe('V2 thinking-persist', () => {
  test.afterAll(cleanupMarked);

  test('@red thinking block visible in history after reload', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    // enable extended thinking if the composer exposes it
    const think = page.locator('button[title*="hink"], [aria-label*="hink"]').first();
    if (await think.isVisible().catch(() => false)) await think.click();
    await composer(page).fill(`${MARK} What is 17 * 23? Think step by step.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    await page.reload();
    await page.waitForTimeout(2000);
    // the persisted transcript must render a thinking affordance
    const block = page.locator('text=/thinking|reasoning/i').first();
    await expect(block, 'no thinking block in reloaded history').toBeVisible({ timeout: 10_000 });
  });
});
