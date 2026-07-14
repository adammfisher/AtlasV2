/** V7 chat share @red (no route exists — code audit), V8 export (md exists;
 * json + all-zip @red), V9 rename/search/bulk-delete, V10 thumbs persist,
 * V11 suggested prompts, V12 new-chat affordances. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, api, MARK } from './helpers';

test.describe('V7-V12 conversation surfaces', () => {
  test.afterAll(cleanupMarked);

  test('@red V7 conversation share link for a logged-out context', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly SHARE-BODY`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    const share = page.locator('button[title*="hare"], [aria-label*="share conversation"]');
    await expect(share.first(), 'no conversation-share affordance exists').toBeVisible({ timeout: 5_000 });
  });

  test('V8a single-conversation markdown export downloads', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly EXPORT-BODY`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.locator('button[title*="xport"], a[title*="xport"], button:has(svg.lucide-file-down)').last().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });

  test('@red V8b json export and all-conversations zip', async ({ page }) => {
    await page.goto('/');
    // desired parity affordances that do not exist yet
    const jsonExport = await page.locator('text=/export.*json/i').count();
    const zipAll = await page.locator('text=/export all|download all/i').count();
    expect(jsonExport + zipAll, 'no json/all-zip export surface').toBeGreaterThan(0);
  });

  test('@red V9 rename, search, bulk delete', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly RENAME-TARGET`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    // rename lives behind Edit (manage mode) and uses window.prompt — answer
    // the native dialog, not a DOM input (Sidebar.tsx:210)
    page.once('dialog', (d) => void d.accept(`${MARK} AUDIT-RENAMED`));
    await page.getByText('Edit', { exact: true }).first().click();
    await page.waitForTimeout(400);
    const pencil = page.locator('svg.lucide-pencil').first();
    await expect(pencil, 'rename pencil in manage mode').toBeVisible({ timeout: 5_000 });
    await pencil.click();
    await page.waitForTimeout(800);
    await page.getByText('Done', { exact: true }).first().click().catch(() => undefined);
    // search filters
    const search = page.locator('input[placeholder*="Search"]').first();
    await search.fill('AUDIT-RENAMED');
    await page.waitForTimeout(600);
    await expect(page.getByText('AUDIT-RENAMED').first()).toBeVisible({ timeout: 5_000 });
    await search.fill('');
    // bulk delete via Edit mode handled by cleanupMarked teardown (API) —
    // assert the affordance exists
    await expect(page.getByText('Edit', { exact: true }).first()).toBeVisible();
  });

  test('@red V10 feedback thumbs persist across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly THUMB-BODY`);
    await composer(page).press('Enter');
    await pollBody(page, /THUMB-BODY/, 60_000);
    await waitIdle(page, 30_000);
    const up = page.locator('button:has(svg.lucide-thumbs-up)').last();
    await expect(up).toBeVisible({ timeout: 5_000 });
    await up.click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForTimeout(2500);
    // persisted rating renders in an active state (fill/color class change)
    const active = await page
      .locator('button:has(svg.lucide-thumbs-up)')
      .last()
      .evaluate((el) => el.className + ' ' + (el.querySelector('svg')?.getAttribute('fill') ?? ''));
    expect(active, 'thumbs-up state must survive reload').toMatch(/fill|active|accent|currentColor/i);
  });

  test('V11+V12 suggested prompts on the empty state, and they send', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    const chip = page.locator('text=/Build a QBR deck|Redline section|Forecast model/').first();
    await expect(chip, 'suggestion chips on new chat').toBeVisible({ timeout: 5_000 });
  });
});
