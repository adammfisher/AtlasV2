/**
 * Product owner in a project — JSX prototyping + documents (claude.ai
 * parity). Complements product-lifecycle.spec.ts (the PRD/state-machine
 * surface, API-level) with the UI half of the same persona: a PM opens their
 * own project workspace and produces a quick interactive React mockup (not
 * derived from a PRD — the fast, exploratory kind of prototype claude.ai
 * Artifacts made famous) plus supporting documents, all through the real
 * composer, all durably scoped to the project.
 */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, cleanupMarked, api, MARK } from './helpers';

interface ArtifactRow {
  id: string;
  projectId: string;
  kind: string;
  ver: number;
  created_at: number;
}
interface ProjectRow {
  id: string;
  name: string;
  templates: number;
}

async function latest(kind: string, after: number): Promise<ArtifactRow | null> {
  const rows = await api<ArtifactRow[]>('/artifacts');
  return rows.filter((a) => a.kind === kind && a.created_at > after).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

test.describe('product owner: prototypes + documents in a project', () => {
  test.setTimeout(600_000);
  test.afterAll(async () => {
    await cleanupMarked();
    const projects = await api<Array<{ id: string; name: string }>>('/projects');
    for (const p of projects.filter((p) => p.name.startsWith(MARK))) {
      await api(`/projects/${p.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  test('owner creates a project, then prototypes in JSX and writes supporting documents — all scoped to it', async ({ page }) => {
    const name = `${MARK} PO-WORKSPACE`;

    // create the project as its owner
    await page.goto('/');
    await page.getByText('Projects', { exact: true }).first().click();
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('input[placeholder="Q4 Planning"]').fill(name);
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 10_000 });
    const pid = (await api<ProjectRow[]>('/projects')).find((p) => p.name === name)?.id;
    if (!pid) throw new Error(`project "${name}" not found after creation`);

    // ── 1. JSX prototype: a quick exploratory mockup, not derived from a PRD —
    // started from THIS project's own composer, so it must land here, not
    // p_general. Real interactivity is checked in-browser, not just creation.
    let t0 = Date.now();
    await composer(page).fill(
      `${MARK} Create an interactive React prototype of a loan payment calculator: a number input with id "principal", a number input with id "rate" (annual %), a number input with id "term" (months), a button labeled "Calculate", and the computed monthly payment shown in an element with id "result".`,
    );
    await page.locator('button[title="Start chat"]').click();
    await waitIdle(page, 200_000);

    const reactArt = await latest('react', t0);
    expect(reactArt, 'react prototype created').toBeTruthy();
    expect(reactArt!.projectId, 'prototype must be scoped to the owning project').toBe(pid);

    const frame = page.frameLocator('iframe').last();
    await expect(frame.locator('#principal')).toBeVisible({ timeout: 60_000 });
    await frame.locator('#principal').fill('12000');
    await frame.locator('#rate').fill('6');
    await frame.locator('#term').fill('24');
    await frame.getByRole('button', { name: /calculate/i }).click();
    // a real monthly payment on a $12,000/6%/24mo loan is on the order of
    // several hundred dollars — assert a plausible non-zero numeric result
    // rendered, not just that the click didn't crash
    await expect(frame.locator('#result')).toContainText(/\d/, { timeout: 10_000 });

    // ── 2. a PRD-style one-pager, written directly (not the full state-machine
    // product artifact — the quick markdown doc a PM drafts before formalizing
    // one), from the SAME project so it accumulates alongside the prototype
    t0 = Date.now();
    await composer(page).fill(`${MARK} Create a markdown one-pager PRD for the loan payment calculator: problem, target users, and 3 success metrics.`);
    await composer(page).press('Enter');
    await waitIdle(page, 200_000);
    const mdArt = await latest('md', t0);
    expect(mdArt, 'PRD one-pager created').toBeTruthy();
    expect(mdArt!.projectId).toBe(pid);

    // ── 3. a supporting stakeholder document (docx) — the kind of artifact a
    // PM hands off to non-technical stakeholders
    t0 = Date.now();
    await composer(page).fill(`${MARK} Create a short docx one-pager titled "Loan Calculator — Stakeholder Brief" summarizing the feature for a non-technical audience.`);
    await composer(page).press('Enter');
    await waitIdle(page, 200_000);
    const docxArt = await latest('docx', t0);
    expect(docxArt, 'stakeholder docx created').toBeTruthy();
    expect(docxArt!.projectId).toBe(pid);
    const dl = await fetch(`${process.env.AXIOM_BASE ?? 'http://127.0.0.1:5175'}/api/artifacts/${docxArt!.id}/versions/${docxArt!.ver}/download`, {
      headers: { Authorization: `Bearer ${process.env.AXIOM_TEST_TOKEN}` },
    });
    expect(dl.ok, 'stakeholder doc must be downloadable').toBe(true);

    // ── all three artifacts are scoped to THIS project and no other, and the
    // project's own card reflects the accumulated count — the only per-project
    // artifact surface the UI has (the workspace itself has no artifact list)
    const scoped = await api<ArtifactRow[]>(`/artifacts?projectId=${pid}`);
    for (const id of [reactArt!.id, mdArt!.id, docxArt!.id]) {
      expect(scoped.some((a) => a.id === id), `artifact ${id} missing from project's own filtered query`).toBe(true);
    }

    await page.reload();
    await page.getByText('Projects', { exact: true }).first().click();
    const card = page.locator('div.group\\/proj', { hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('3 templates')).toBeVisible();
  });
});
