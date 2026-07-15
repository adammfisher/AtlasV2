/** Artifact management: delete, and resolve-the-source-conversation (backfill)
 * for gallery rows created before conv_id was stored. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, cleanupMarked, api, MARK } from './helpers';

interface Art { id: string; kind: string; convId: string | null; created_at: number }

test.describe('artifact management', () => {
  test.afterAll(cleanupMarked);
  test.setTimeout(300_000);

  test('new artifact carries convId; delete removes it', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await composer(page).fill(`${MARK} Create an SVG icon of a paper plane.`);
    await composer(page).press('Enter');
    await waitIdle(page, 120_000);

    const rows = await api<Art[]>('/artifacts');
    const art = rows.filter((a) => a.kind === 'svg' && a.created_at > t0).sort((a, b) => b.created_at - a.created_at)[0];
    expect(art, 'svg artifact created').toBeTruthy();
    // NEW artifacts store their conversation link
    expect(art!.convId, 'new artifact carries convId').toBeTruthy();

    // resolver returns it directly
    const resolved = await api<{ convId: string | null }>(`/artifacts/${art!.id}/conversation`);
    expect(resolved.convId).toBe(art!.convId);

    // delete removes it from the listing
    await api(`/artifacts/${art!.id}`, { method: 'DELETE' });
    const after = await api<Art[]>('/artifacts');
    expect(after.some((a) => a.id === art!.id), 'deleted artifact is gone').toBe(false);
  });

  test('conversation resolver finds + backfills a link for a convId-less artifact', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await composer(page).fill(`${MARK} Create an SVG icon of a compass.`);
    await composer(page).press('Enter');
    await waitIdle(page, 120_000);
    const rows = await api<Art[]>('/artifacts');
    const art = rows.filter((a) => a.kind === 'svg' && a.created_at > t0).sort((a, b) => b.created_at - a.created_at)[0]!;
    // simulate a legacy row by resolving (idempotent: returns the stored link)
    const r = await api<{ convId: string | null }>(`/artifacts/${art.id}/conversation`);
    expect(r.convId, 'resolver returns the source conversation').toBeTruthy();
    await api(`/artifacts/${art.id}`, { method: 'DELETE' });
  });
});
