import { test, expect } from '@playwright/test';
import { sendNew, send, waitIdle, cleanupMarked, api, API, MARK } from './helpers';

/** Artifact pipeline through the UI: diagram create → preview → edit → v2 →
 * share; one office format as the build-chain smoke (pptx). The remaining
 * office kinds are covered by their shared pipeline + earlier verification. */
test.describe('artifacts @generation', () => {
  test.afterAll(cleanupMarked);

  test('mermaid: create → preview → edit → v2 → share link downloads', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Draw a mermaid flowchart with nodes Alpha, Beta, Gamma in sequence.');
    await waitIdle(page, 180_000);
    // open the panel via the artifact card and confirm a rendered preview
    await page.locator('text=/diagram|\\.mmd/i').first().click();
    await expect(page.getByText(/Download as/)).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('svg, iframe').count()).toBeGreaterThan(0);
    // edit → v2
    await send(page, 'Add a node Delta after Gamma.');
    await waitIdle(page, 180_000);
    const arts = await api<Array<{ id: string; name: string; ver: number }>>('/artifacts');
    const diagram = arts.find((a) => a.name.endsWith('.mmd'));
    expect(diagram?.ver).toBeGreaterThanOrEqual(2);
    // share → presigned URL → fetch it
    await page.locator('button[title*="Share"]').first().click();
    await expect(page.getByText(/Share link copied/)).toBeVisible({ timeout: 20_000 });
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toContain('X-Amz-Signature');
    const res = await fetch(url);
    expect(res.ok).toBe(true);
  });

  test('pptx: office build chain produces a downloadable deck', async ({ page }) => {
    const before = new Set(
      (await api<Array<{ id: string }>>('/artifacts')).map((a) => a.id),
    );
    await page.goto('/');
    await sendNew(page, 'Create a 2-slide deck: cover and one content slide, topic: e2e regression.');
    // poll until the deck exists AND its file downloads — the artifact row
    // appears before build_pptx.py finishes writing the file
    await expect
      .poll(
        async () => {
          const arts = await api<Array<{ id: string; kind: string; ver: number }>>('/artifacts');
          const deck = arts.find((a) => a.kind === 'pptx' && !before.has(a.id));
          if (!deck) return 'no artifact yet';
          const dl = await fetch(`${API}/artifacts/${deck.id}/versions/${deck.ver}/download`);
          if (!dl.ok) return `download ${dl.status}`;
          const bytes = (await dl.arrayBuffer()).byteLength;
          return bytes > 20_000 ? 'ok' : `too small: ${bytes}`;
        },
        { timeout: 240_000, intervals: [3000] },
      )
      .toBe('ok');
  });

  test('web tools: search chip appears for a live question', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Search the web for the capital of Australia and cite a source.');
    await waitIdle(page, 120_000);
    await expect(page.getByText(/web_search · web/).first()).toBeVisible();
  });

  test('mcp connector tool executes in chat', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Use your filesystem tool to list your workspace directory contents.');
    await waitIdle(page, 120_000);
    await expect(page.getByText(/· Filesystem/).first()).toBeVisible();
  });
});
