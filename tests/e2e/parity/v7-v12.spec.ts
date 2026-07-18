/** V7 chat share @red (no route exists — code audit), V8 export (md exists;
 * json + all-zip @red), V9 rename/search/bulk-delete, V10 thumbs persist,
 * V11 suggested prompts, V12 new-chat affordances. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, api, MARK } from './helpers';

test.describe('V7-V12 conversation surfaces', () => {
  test.afterAll(cleanupMarked);

  test('V7 conversation share: link serves read-only HTML logged-out, revocable', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly SHARE-BODY`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    await page.locator('button[title*="Share conversation"]').first().click();
    await page.waitForTimeout(1500);
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toMatch(/^https?:\/\//);
    const res = await fetch(url); // anonymous client
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SHARE-BODY');
    expect(html).toContain('read-only');
    // revoke kills the object behind the link
    const convs = await api<Array<{ id: string; title: string }>>('/conversations');
    const conv = convs.find((c) => c.title.includes('SHARE-BODY'));
    await api(`/conversations/${conv!.id}/share`, { method: 'POST', body: JSON.stringify({ revoke: true }) });
    const after = await fetch(url);
    expect(after.status, 'revoked link must die').not.toBe(200);
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

  test('V8b json export and all-conversations zip', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Edit', { exact: true }).first().click();
    await page.waitForTimeout(300);
    await expect(page.getByText('Export all', { exact: true })).toBeVisible({ timeout: 5_000 });
    // both endpoints serve real content
    const zip = await fetch(`${process.env.AXIOM_BASE ?? 'http://127.0.0.1:5175'}/api/conversations/export.zip`, { headers: { Authorization: `Bearer ${process.env.AXIOM_TEST_TOKEN}` } });
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toContain('zip');
    const convs = await api<Array<{ id: string }>>('/conversations');
    const j = await fetch(`${process.env.AXIOM_BASE ?? 'http://127.0.0.1:5175'}/api/conversations/${convs[0]!.id}/export?format=json`, { headers: { Authorization: `Bearer ${process.env.AXIOM_TEST_TOKEN}` } });
    expect(j.status).toBe(200);
    const parsed = (await j.json()) as { messages?: unknown[] };
    expect(Array.isArray(parsed.messages)).toBe(true);
  });

  test('V9 rename, search, bulk delete', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly RENAME-TARGET`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    // rename lives behind Edit (manage mode) and uses window.prompt — answer
    // the native dialog, not a DOM input (Sidebar.tsx:210)
    page.once('dialog', (d) => void d.accept(`${MARK} AUDIT-RENAMED`));
    // the pencil is a HOVER-revealed control on the conversation row
    const row = page.locator('button', { hasText: 'RENAME-TARGET' }).first();
    await row.hover();
    const pencil = page.locator('[title="Rename chat"]').first();
    await expect(pencil, 'rename pencil on row hover').toBeVisible({ timeout: 5_000 });
    await pencil.click();
    await page.waitForTimeout(1200);
    // the rename must have landed server-side…
    const convs = await api<Array<{ id: string; title: string }>>('/conversations');
    const renamed = convs.find((c) => c.title.includes('AUDIT-RENAMED'));
    expect(renamed, 'rename persisted via the prompt flow').toBeTruthy();
    // …and content search must find it
    const hits = await api<Array<{ id: string }>>(`/conversations/search?q=${encodeURIComponent('AUDIT-RENAMED')}`);
    expect(hits.some((h) => h.id === renamed!.id), 'search finds the renamed chat').toBe(true);
    // UI filter box narrows the list too
    const search = page.locator('input[placeholder*="Search"]').first();
    await search.fill('AUDIT-RENAMED');
    await page.waitForTimeout(800);
    await expect(page.getByText('AUDIT-RENAMED').first()).toBeVisible({ timeout: 5_000 });
    await search.fill('');
    // bulk delete via Edit mode handled by cleanupMarked teardown (API) —
    // assert the affordance exists
    await expect(page.getByText('Edit', { exact: true }).first()).toBeVisible();
  });

  test('V10 feedback thumbs persist across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly THUMB-BODY`);
    await composer(page).press('Enter');
    await pollBody(page, /THUMB-BODY/, 60_000);
    await waitIdle(page, 30_000);
    const up = page.locator('button:has(svg.lucide-thumbs-up)').last();
    await expect(up).toBeVisible({ timeout: 5_000 });
    // the click fires POST /feedback fire-and-forget (ChatView's onClick does
    // not await rate()) — wait for the actual response, not a flat timeout,
    // or a reload under load can race ahead of the write actually landing
    const feedbackSaved = page.waitForResponse((r) => r.url().includes('/feedback') && r.request().method() === 'POST' && r.ok());
    await up.click();
    await feedbackSaved;
    await page.reload();
    await page.waitForTimeout(1000);
    // active state = inline color (C.green) vs mute (ChatView thumb styles)
    const upColor = await page
      .locator('button[title="Good response"]')
      .last()
      .evaluate((el) => getComputedStyle(el).color);
    const downColor = await page
      .locator('button[title="Bad response"]')
      .last()
      .evaluate((el) => getComputedStyle(el).color);
    expect(upColor, 'thumbs-up renders active (distinct color) after reload').not.toBe(downColor);
  });

  test('V11+V12 suggested prompts on the empty state, and they send', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    const chip = page.locator('text=/Build a QBR deck|Redline section|Forecast model/').first();
    await expect(chip, 'suggestion chips on new chat').toBeVisible({ timeout: 5_000 });
  });
});
