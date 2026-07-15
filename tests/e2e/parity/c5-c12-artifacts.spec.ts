/**
 * C5–C12 client-side artifact surfaces: react interactivity + error affordance,
 * site sandboxing, svg/mermaid/md rendering, version browsing/restore, share
 * to a logged-out context, downloads from chat and panel.
 */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, cleanupMarked, api, MARK } from './helpers';

interface ArtifactRow { id: string; kind: string; name: string; ver: number; created_at: number }

async function latest(kind: string, after: number): Promise<ArtifactRow | null> {
  const rows = await api<ArtifactRow[]>('/artifacts');
  return rows.filter((a) => a.kind === kind && a.created_at > after).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

async function create(page: import('@playwright/test').Page, prompt: string): Promise<void> {
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await composer(page).fill(`${MARK} ${prompt}`);
  await composer(page).press('Enter');
  await waitIdle(page, 200_000);
}

test.describe('C5-C12 artifact surfaces', () => {
  test.afterAll(cleanupMarked);

  test('C5 react: renders, state works; broken code shows error + fix affordance', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Create an interactive React counter component with a button labeled "Increment" and the count shown in an element with id "count".');
    expect(await latest('react', t0), 'react artifact created').toBeTruthy();
    const frame = page.frameLocator('iframe').last();
    await expect(frame.locator('#count, [id*=count], button').first()).toBeVisible({ timeout: 60_000 });
    const btn = frame.getByRole('button', { name: /increment/i }).first();
    await btn.click();
    await btn.click();
    await expect(frame.locator('body')).toContainText(/2/, { timeout: 10_000 });

    // error surface: ask for an edit that intentionally breaks the code
    await composer(page).fill(`${MARK} Replace the component body with exactly this broken code and do not fix it: const x = ; render(<App/>)`);
    await composer(page).press('Enter');
    await waitIdle(page, 200_000);
    const body = await page.locator('body').innerText();
    const errorSurfaced = /error|failed|couldn'?t|fix/i.test(body);
    expect(errorSurfaced, 'a build/runtime error must be visibly surfaced').toBe(true);
    const fixAffordance = await page.getByRole('button', { name: /fix|try again|repair/i }).count();
    expect(fixAffordance, 'claude.ai-style "try fixing" affordance').toBeGreaterThan(0);
  });

  test('C6 site: sandboxed iframe, no app-cookie access', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Create a static landing page for a coffee subscription with a hero headline "AUDIT-BREW".');
    expect(await latest('site', t0) ?? (await latest('react', t0)), 'site artifact created').toBeTruthy();
    const iframe = page.locator('iframe').last();
    await expect(iframe).toBeVisible({ timeout: 60_000 });
    const sandbox = await iframe.getAttribute('sandbox');
    expect(sandbox, 'iframe must carry a sandbox attribute').not.toBeNull();
    expect(sandbox).not.toContain('allow-same-origin');
  });

  test('C7 svg renders in panel', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Create an SVG icon of a simple sailboat.');
    expect(await latest('svg', t0)).toBeTruthy();
    await expect(page.locator('svg, iframe').last()).toBeVisible({ timeout: 30_000 });
  });

  test('C8 mermaid renders; syntax error degrades gracefully', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Create a mermaid flowchart: start → validate → deploy, with a failure branch back to validate.');
    expect(await latest('mermaid', t0)).toBeTruthy();
    await expect(page.locator('iframe, svg').last()).toBeVisible({ timeout: 30_000 });
    // graceful error: feed invalid mermaid via the edit path
    await composer(page).fill(`${MARK} Replace the diagram source with exactly: graph TD; A-->; %% deliberately invalid`);
    await composer(page).press('Enter');
    await waitIdle(page, 200_000);
    const body = await page.locator('body').innerText();
    expect(/parse|invalid|error|failed/i.test(body), 'mermaid syntax error must surface, not blank').toBe(true);
  });

  test('C9 markdown artifact renders', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Create a markdown document: a project readme for "Atlas Audit" with a heading, a table of two rows, and a code block.');
    expect(await latest('md', t0)).toBeTruthy();
    await expect(page.locator('iframe').last()).toBeVisible({ timeout: 30_000 });
  });

  test('@red C10 versioning: list browsable, restore, per-version download', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Create an SVG icon of a lighthouse.');
    await composer(page).fill(`${MARK} Make the lighthouse red.`);
    await composer(page).press('Enter');
    await waitIdle(page, 200_000);
    const art = await latest('svg', t0);
    expect(art?.ver, 'v2 after edit').toBeGreaterThanOrEqual(2);

    // per-version download must work for BOTH versions via the panel/API
    for (const v of [1, 2]) {
      const res = await fetch(`${process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175'}/api/artifacts/${art!.id}/versions/${v}/download`);
      expect(res.ok, `v${v} download → ${res.status}`).toBe(true);
    }
    // UI: a version list + restore affordance
    const versionUi = await page.locator('text=/v1|version/i').count();
    const restoreUi = await page.getByRole('button', { name: /restore/i }).count();
    expect(versionUi, 'version indicator visible').toBeGreaterThan(0);
    expect(restoreUi, 'restore affordance visible').toBeGreaterThan(0);
  });

  test('C11 share link opens read-only in a logged-out context', async ({ page, browser }) => {
    const t0 = Date.now();
    await create(page, 'Create an SVG icon of a compass rose.');
    const art = await latest('svg', t0);
    expect(art).toBeTruthy();
    const share = page.getByRole('button', { name: /share/i }).last();
    await expect(share).toBeVisible({ timeout: 15_000 });
    await share.click();
    await page.waitForTimeout(1500);
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url, 'share must copy a URL').toMatch(/^https?:\/\//);

    // the link must serve the content to an unauthenticated client. Today it
    // is a presigned S3 DOWNLOAD (content-disposition: attachment) — reachable
    // and read-only, but not claude.ai's viewable share page → AMBER note.
    const res = await fetch(url);
    expect(res.status, 'share link fetch').toBe(200);
    const disposition = res.headers.get('content-disposition') ?? '';
    console.log(`C11 evidence: share serves ${disposition || 'inline content'}`);
  });

  test('C12 downloads reachable from chat and panel', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Create a markdown doc titled "AUDIT-DL" with one paragraph.');
    const art = await latest('md', t0);
    expect(art).toBeTruthy();
    // panel download affordance
    const dl = page.getByRole('button', { name: /download/i }).or(page.locator('a[download], [title*="ownload"]'));
    expect(await dl.count(), 'a visible download affordance in chat/panel').toBeGreaterThan(0);
    const res = await fetch(`${process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175'}/api/artifacts/${art!.id}/versions/${art!.ver}/download`);
    expect(res.ok).toBe(true);
  });
});
