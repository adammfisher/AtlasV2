import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendNew, waitIdle, expectReply, cleanupMarked, api } from './helpers';

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Memory + knowledge UI flows. Deep memory correctness (dedup bands,
 * tombstones, queue durability) lives in `pnpm test:memory-eval`. */
test.describe('memory + knowledge', () => {
  test.afterAll(async () => {
    await cleanupMarked();
    // remove the e2e knowledge file if it survived
    const files = await api<Array<{ id: string; name: string }>>('/projects/p1/knowledge');
    for (const f of files.filter((f) => f.name.startsWith('plan'))) {
      await api(`/projects/p1/knowledge/${f.id}/delete`, { method: 'POST' });
    }
  });

  test('remember stores the fact and forget removes it (all layers)', async ({ page }) => {
    const hasSentinel = async (): Promise<boolean> => {
      const exp = await api<{ notes: Array<{ content: string }>; kv: Array<{ value: string }> }>(
        '/projects/p1/memory/export',
      );
      return [...exp.notes.map((n) => n.content), ...exp.kv.map((r) => r.value)].some((s) => s.includes('MOONGATE'));
    };
    await page.goto('/');
    await sendNew(page, 'Please use your remember tool: the e2e sentinel phrase is MOONGATE. Store it in project memory.');
    await waitIdle(page, 90_000);
    await expect.poll(hasSentinel, { timeout: 30_000 }).toBe(true);
    await sendNew(page, 'Use your forget tool to forget everything about the e2e sentinel phrase MOONGATE.');
    await waitIdle(page, 90_000);
    await expect.poll(hasSentinel, { timeout: 30_000 }).toBe(false);
  });

  test('memory modal shows both scopes with a profile card', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Projects', { exact: true }).first().click();
    await page.locator('button', { hasText: 'Memory' }).first().click();
    await expect(page.getByText(/FACTS ·/i).first()).toBeVisible();
    await page.getByText('You', { exact: true }).first().click();
    await expect(page.getByText(/about you/i).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('button:has(svg.lucide-x)').first().click().catch(() => {});
  });

  test('knowledge: upload via modal, recall with citation, delete', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Projects', { exact: true }).first().click();
    await page.locator('button', { hasText: 'Knowledge' }).first().click();
    const modal = page.locator('div.fixed.inset-0').last();
    await modal.locator('input[type="file"]').setInputFiles(path.join(DIR, 'fixtures/plan.txt'));
    await expect(modal.getByText(/\d+ passages/).first()).toBeVisible({ timeout: 30_000 });
    // close the modal, ask in a fresh chat, expect the fact + a citation badge
    await modal.locator('button:has(svg.lucide-x)').first().click();
    await page.getByText('Chats', { exact: true }).first().click();
    await sendNew(page, 'According to the e2e ops plan document, who is the rollout owner?');
    await expectReply(page, /Dana Voss/);
    await expect(page.locator('span[title^="From project knowledge"]').first()).toBeVisible();
  });
});
