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
    // in case the knowledge test failed before reaching its own cleanup, don't
    // leave the isolated test project behind
    const projects = await api<Array<{ id: string; name: string }>>('/projects');
    for (const p of projects.filter((p) => p.name.startsWith('[e2e]'))) {
      await api(`/projects/${p.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  test('remember stores the fact and forget removes it (all layers)', async ({ page }) => {
    const hasSentinel = async (): Promise<boolean> => {
      const exp = await api<{ notes: Array<{ content: string }>; kv: Array<{ value: string }> }>(
        '/projects/p_general/memory/export',
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
    // open the General project's workspace, then expand its inline Memory
    // card (a small pencil-edit button, not a button literally named "Memory")
    await page.getByText('General', { exact: true }).first().click();
    await page.locator('button[title="View & edit memory"]').first().click();
    const modal = page.locator('div.fixed.inset-0').last();
    await expect(modal.getByText(/FACTS ·/i).first()).toBeVisible();
    await modal.getByText('You', { exact: true }).first().click();
    await expect(modal.getByText(/about you/i).first()).toBeVisible();
    // close via the modal's own X — a page-wide "svg.lucide-x" locator also
    // matches every per-file remove button in the Files card behind the
    // modal's scrim, and Playwright hangs retrying a click on a covered element
    await modal.locator('button:has(svg.lucide-x)').first().click();
  });

  test('knowledge: upload via modal, recall with citation, delete', async ({ page }) => {
    // an isolated project, not the shared General workspace: the General
    // project's knowledge base has accumulated documents from every other
    // suite that has ever run a "New chat" upload, and vector search over
    // that much unrelated noise can bury this fixture's one relevant chunk
    // below the recall threshold — a real citation miss, but caused by
    // shared test-data pollution, not a product bug.
    const proj = await api<{ id: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: '[e2e] Knowledge Isolated' }),
    });
    await page.goto('/');
    await page.getByText('Projects', { exact: true }).first().click();
    await page.getByText('[e2e] Knowledge Isolated', { exact: true }).first().click();
    await page.locator('button[title="View & manage knowledge files"]').first().click();
    const modal = page.locator('div.fixed.inset-0').last();
    await modal.locator('input[type="file"]').setInputFiles(path.join(DIR, 'fixtures/plan.txt'));
    await expect(modal.getByText(/\d+ passages/).first()).toBeVisible({ timeout: 30_000 });
    // close the modal, ask in a fresh chat SCOPED TO THIS PROJECT, expect the
    // fact + a citation badge
    await modal.locator('button:has(svg.lucide-x)').first().click();
    const conv = await api<{ id: string }>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ projectId: proj.id }),
    });
    await page.goto(`/c/${conv.id}`);
    await page.locator('textarea').first().fill('[e2e] According to the e2e ops plan document, who is the rollout owner?');
    await page.locator('textarea').first().press('Enter');
    await expectReply(page, /Dana Voss/);
    // index-grounded citations (D.1) render as a numbered chip button carrying
    // the passage id, not the legacy "[source: X]" prose span
    await expect(page.locator('button.chat-chip[data-passage]').first()).toBeVisible();
    await api(`/projects/${proj.id}`, { method: 'DELETE' });
  });
});
