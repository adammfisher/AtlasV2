/**
 * Project-owner → artifact scoping (claude.ai parity). No existing spec
 * covers this path: m2-isolation.ts plants a memory fact + conversation per
 * project but never an artifact (its own artifact assertion is vacuous —
 * `[].every(...)` passes trivially on an empty array); x-polish's X7 checks
 * the cross-chat GALLERY surface but never a single project's scoping. This
 * exercises the real UI path claude.ai's Projects feature promises: an owner
 * creates a project, generates an artifact from THAT project's own composer
 * (newChatInProject) — not the sidebar "New chat", which always lands in
 * p_general — and the artifact must be durably scoped to it, both server-side
 * (the filtered API) and in the only UI surface that shows a per-project
 * artifact count (ProjectWorkspace itself has no artifact list at all).
 */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, cleanupMarked, api, MARK } from './helpers';

interface ArtifactRow {
  id: string;
  projectId: string;
  kind: string;
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

test.describe('project-owner artifact scoping', () => {
  test.afterAll(async () => {
    await cleanupMarked();
    const projects = await api<Array<{ id: string; name: string }>>('/projects');
    for (const p of projects.filter((p) => p.name.startsWith(MARK))) {
      await api(`/projects/${p.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  test('artifact created from a project workspace composer is scoped to that project, not p_general or a sibling', async ({ page }) => {
    const nameA = `${MARK} PROJ-ARTIFACT-A`;

    // create the project AS ITS OWNER, via the real UI modal
    await page.goto('/');
    await page.getByText('Projects', { exact: true }).first().click();
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('input[placeholder="Q4 Planning"]').fill(nameA);
    await page.getByRole('button', { name: 'Create project' }).click();
    // ProjectsView.create() drops straight into the new project's own workspace
    await expect(page.getByRole('heading', { name: nameA })).toBeVisible({ timeout: 10_000 });
    const pidA = (await api<ProjectRow[]>('/projects')).find((p) => p.name === nameA)?.id;
    if (!pidA) throw new Error(`project "${nameA}" not found after creation`);

    // a sibling project as the isolation control — never touched by A's chat
    const pidB = (
      await api<{ id: string }>('/projects', { method: 'POST', body: JSON.stringify({ name: `${MARK} PROJ-ARTIFACT-B` }) })
    ).id;

    const t0 = Date.now();
    // THE project's OWN composer — placeholder reads "Start a new chat in
    // <name>…" and its send button is startChat() → newChatInProject(), the
    // only client path that creates a conversation with an explicit,
    // non-general projectId
    await composer(page).fill(`${MARK} Create an SVG icon of a compass rose.`);
    await page.locator('button[title="Start chat"]').click();
    await waitIdle(page, 200_000);

    const art = await latest('svg', t0);
    expect(art, 'artifact created from the project composer').toBeTruthy();
    expect(art!.projectId, "artifact must carry project A's id, not p_general or B").toBe(pidA);

    // server-side scoping: each project's own filtered query
    const artsB = await api<ArtifactRow[]>(`/artifacts?projectId=${pidB}`);
    expect(artsB.some((a) => a.id === art!.id), "project B's filtered query must not see A's artifact").toBe(false);
    const artsA = await api<ArtifactRow[]>(`/artifacts?projectId=${pidA}`);
    expect(artsA.some((a) => a.id === art!.id), "project A's own filtered query must see it").toBe(true);

    // client-side surface: reload (the app's projects query has no
    // subscription to server-side state, so a stale in-memory cache would
    // otherwise mask a real regression here) and check the project's OWN
    // card — `templates` is the only per-project artifact count the UI shows
    await page.reload();
    await page.getByText('Projects', { exact: true }).first().click();
    const card = page.locator('div.group\\/proj', { hasText: nameA });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('1 templates')).toBeVisible();

    await api(`/projects/${pidB}`, { method: 'DELETE' });
  });
});
