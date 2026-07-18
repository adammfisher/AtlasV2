import { test, expect } from '@playwright/test';
import { sendNew, expectReply, cleanupMarked, api, MARK } from './helpers';

test.describe('shell + management @fast', () => {
  test.afterAll(cleanupMarked);

  test('model menu offers the configured models (adammfisher: all 4) and switching sticks', async ({ page }) => {
    await page.goto('/');
    const picker = page.locator('button', { hasText: /Claude (Haiku 4\.5|Sonnet)/ }).last();
    await picker.click();
    await expect(page.getByText('Claude Haiku 4.5', { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/Claude Sonnet/).last()).toBeVisible();
    await expect(page.getByText(/Nova/).last()).toBeVisible();
    await page.keyboard.press('Escape');
    const reg = await api<{ bedrockModels: unknown[] }>('/models');
    expect(reg.bedrockModels).toHaveLength(4); // haiku, sonnet, nova, nemotron — adammfisher allowlist (users.config.json)
  });

  test('theme toggle flips the rendered palette and persists', async ({ page }) => {
    // ThemePicker.tsx: a single click only opens a 5-palette menu now
    // ("Replaces the old light/dark toggle") — the theme changes on
    // selecting a palette from it, not on the opening click itself.
    await page.goto('/');
    const sidebarBg = () =>
      page.evaluate(() => {
        const el = document.querySelector('div[style*="width: 264"]');
        return el ? getComputedStyle(el).backgroundColor : '';
      });
    const before = await sidebarBg();
    const toggle = page.locator('button[title*="heme"]');
    const openAndPick = async (selector: string): Promise<void> => {
      await toggle.click();
      const menu = page.getByRole('menu', { name: 'Theme' });
      await expect(menu).toBeVisible();
      // 5 palettes means 4 always match "[aria-checked=false]" — pick the
      // first (the restore call's :has-text(...) filter narrows to exactly
      // one already, so .first() is a no-op there)
      await menu.locator(selector).first().click();
    };
    const activeLabel = await (async () => {
      await toggle.click();
      const menu = page.getByRole('menu', { name: 'Theme' });
      await expect(menu).toBeVisible();
      const label = (await menu.locator('[aria-checked="true"]').innerText()).trim();
      await page.keyboard.press('Escape');
      return label;
    })();
    await openAndPick('[aria-checked="false"]');
    await page.waitForTimeout(400);
    expect(await sidebarBg()).not.toBe(before);
    await page.reload({ waitUntil: 'networkidle' });
    expect(await sidebarBg()).not.toBe(before); // persisted
    await openAndPick(`[aria-checked="false"]:has-text("${activeLabel}")`); // restore
  });

  test('mobile drawer: hamburger opens the sidebar', async ({ browser }) => {
    const mp = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await mp.goto((process.env.AXIOM_BASE ?? 'http://127.0.0.1:5173') + '/', { waitUntil: 'networkidle' });
    await expect(mp.locator('button[title="Menu"]')).toBeVisible();
    expect(await mp.getByText('RECENTS').isVisible().catch(() => false)).toBe(false);
    await mp.locator('button[title="Menu"]').click();
    await expect(mp.getByText('RECENTS')).toBeVisible();
    await mp.close();
  });

  test('rename and search find the chat', async ({ page }) => {
    page.on('dialog', (d) => void d.accept(`${MARK} Renamed E2E Chat`));
    await page.goto('/');
    await sendNew(page, 'Say exactly: RENAME-ME');
    await expectReply(page, /RENAME-ME/);
    const row = page.locator('.group\\/conv').first();
    await row.hover();
    await row.locator('[title="Rename chat"]').click({ force: true });
    await expect(page.getByText('Renamed E2E Chat').first()).toBeVisible();
    await page.locator('input[placeholder="Search chats…"]').fill('Renamed E2E');
    await page.waitForTimeout(800);
    expect(await page.locator('.group\\/conv').count()).toBeLessThanOrEqual(2);
    await page.locator('input[placeholder="Search chats…"]').fill('');
  });

  test('bulk delete mode exposes select-all', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Edit', { exact: true }).first().click();
    await expect(page.getByText(/Select all|Clear all/)).toBeVisible();
    await expect(page.getByText(/Delete/)).toBeVisible();
    await page.getByText('Done', { exact: true }).first().click();
  });
});
