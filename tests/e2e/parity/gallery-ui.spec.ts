/** Gallery UX in a real browser: clicking a row opens the artifact panel and
 * navigates into a chat; the delete button removes a row. */
import { test, expect } from '@playwright/test';
import { api } from './helpers';

test.describe('gallery UI', () => {
  test('clicking an artifact row opens it (panel + chat nav)', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Artifacts', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    const firstRow = page.locator('[title^="Open "]').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow.click();
    // resolves the source conversation → navigates into a chat (/c/<id>)
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toMatch(/^\/c\//);
    // and the artifact panel opens on the right (download action or a preview frame)
    const panel = page.getByText(/Download as/i).or(page.locator('iframe')).first();
    await expect(panel).toBeVisible({ timeout: 15_000 });
  });

  test('delete button removes an artifact', async ({ page }) => {
    // make a throwaway artifact to delete via the UI
    const conv = await api<{ id: string }>('/conversations', { method: 'POST', body: '{}' });
    // count before
    const before = await api<Array<{ id: string }>>('/artifacts');
    await page.goto('/');
    await page.getByText('Artifacts', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    // auto-confirm the delete dialog
    page.on('dialog', (d) => void d.accept());
    const firstDelete = page.locator('button[title^="Delete "]').first();
    await firstDelete.click({ force: true });
    await page.waitForTimeout(2000);
    const after = await api<Array<{ id: string }>>('/artifacts');
    expect(after.length, 'one artifact removed').toBeLessThan(before.length);
    await api('/conversations/delete', { method: 'POST', body: JSON.stringify({ ids: [conv.id] }) }).catch(() => undefined);
  });
});
