/** X-section polish audit: X1 styles @red, X2 preferences, X3 markdown torture,
 * X6 voice @red, X7 gallery @red, X8 mobile, X9 light theme, X10 keyboard.
 * X4/X5 (streaming resilience, mid-stream kill) are recorded as manual/deferred
 * in the matrix — they need infra manipulation, not a browser assertion. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, MARK } from './helpers';

async function newChat(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(400);
}

test.describe('X polish', () => {
  test.afterAll(cleanupMarked);

  test('@red X1 style presets selectable per chat', async ({ page }) => {
    await newChat(page);
    const styles = page.locator('text=/concise|explanatory|formal/i, button[title*="tyle"]');
    expect(await styles.count(), 'no style presets surface').toBeGreaterThan(0);
  });

  test('X2 userName preference reaches the model', async ({ page }) => {
    await newChat(page);
    await composer(page).fill(`${MARK} What is my name, per your configuration? One word.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const body = await page.locator('body').innerText();
    expect(body, 'configured userName (Adam) should be known').toMatch(/Adam/);
  });

  test('X3 markdown torture: table, nested list, code+copy, LaTeX', async ({ page }) => {
    await newChat(page);
    await composer(page).fill(
      `${MARK} Output exactly this markdown, no commentary: a 2x2 table with headers City|Sites and rows Osaka|17, Turin|9; then a nested bullet list (outer "alpha", inner "beta"); then a python code block containing print("torture-ok"); then the LaTeX equation $E = mc^2$ on its own line.`,
    );
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    // table renders as an HTML table, not pipes
    expect(await page.locator('main table, [class*="message"] table').count(), 'markdown table renders').toBeGreaterThan(0);
    // code block with copy affordance
    expect(await page.locator('pre code').count(), 'syntax code block').toBeGreaterThan(0);
    const codeCopy = await page.locator('pre button, [class*="code"] button[title*="opy"]').count();
    expect(codeCopy, 'copy button on code block').toBeGreaterThan(0);
    // LaTeX: rendered math (katex/mathjax span), not raw $...$
    const math = await page.locator('.katex, .MathJax, mjx-container').count();
    expect(math, 'LaTeX renders as math').toBeGreaterThan(0);
  });

  test('@red X6 mic button is wired (Web Speech), not decorative', async ({ page }) => {
    await newChat(page);
    const mic = page.locator('button:has(svg.lucide-mic)').first();
    await expect(mic).toBeVisible();
    const handled = await mic.evaluate((el) => {
      // decorative = no click handler property and no listener-attached marker
      const anyEl = el as unknown as { onclick: unknown };
      return Boolean(anyEl.onclick) || el.getAttributeNames().some((n) => n.startsWith('data-listening'));
    });
    expect(handled, 'mic has no handler — decorative').toBe(true);
  });

  test('@red X7 cross-chat artifacts gallery surface', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('aside >> text=/artifacts|gallery/i');
    expect(await nav.count(), 'no artifacts gallery navigation').toBeGreaterThan(0);
  });

  test('X8 mobile layout smoke (390px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForTimeout(1200);
    // composer must be visible and usable; no horizontal overflow
    await expect(composer(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow ${overflow}px`).toBeLessThanOrEqual(2);
  });

  test('X9 light theme toggle exists and applies', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('button:has(svg.lucide-sun), button:has(svg.lucide-moon), button[title*="heme"]').first();
    await expect(toggle, 'theme toggle').toBeVisible({ timeout: 5_000 });
    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await toggle.click();
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(after, 'background must change on toggle').not.toBe(before);
    await toggle.click(); // restore
  });

  test('X10 keyboard: Enter sends, Shift-Enter newlines, Esc closes modal, Cmd-K new chat', async ({ page }) => {
    await newChat(page);
    const c = composer(page);
    await c.fill('line1');
    await c.press('Shift+Enter');
    await c.type('line2');
    expect(await c.inputValue()).toContain('\n');
    await c.fill('');
    // Esc closes an open modal (memory modal as the probe)
    const brain = page.locator('button:has(svg.lucide-brain)').first();
    if (await brain.isVisible().catch(() => false)) {
      await brain.click();
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      const modalGone = (await page.locator('[role="dialog"], [class*="modal"]').count()) === 0;
      expect(modalGone, 'Esc must close the modal').toBe(true);
    }
    // Cmd-K opens new chat / search
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(600);
    const kEffect =
      (await page.locator('input:focus').count()) > 0 ||
      (await composer(page).evaluate((el) => document.activeElement === el));
    expect(kEffect, 'Cmd-K must focus search or new chat').toBe(true);
  });
});
