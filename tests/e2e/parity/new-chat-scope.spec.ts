/** USER BUG 2026-07-14: sidebar "New chat" inherited the ACTIVE project —
 * general chats got project instructions and project memory scope. Now:
 * sidebar → General (neutral, no instructions); a chat created with an
 * explicit projectId stays in that project. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, cleanupMarked, api, MARK } from './helpers';

interface Conv { id: string; projectId?: string; title: string }

test.describe('new-chat scoping', () => {
  test.afterAll(cleanupMarked);

  test('sidebar New chat lands in General, not the active project', async ({ page }) => {
    // make a real project active so inheritance would be visible
    const projects = await api<Array<{ id: string; name: string }>>('/projects');
    const real = projects.find((p) => p.id !== 'p_general');
    expect(real).toBeTruthy();
    await api('/settings', { method: 'PATCH', body: JSON.stringify({ activeProjectId: real!.id }) });

    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Reply with exactly SCOPE-CHECK`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);

    const convs = await api<Conv[]>('/conversations');
    const mine = convs.find((c) => c.title.includes('SCOPE-CHECK') || c.title.includes(MARK));
    expect(mine, 'conversation exists').toBeTruthy();
    expect(mine!.projectId, 'sidebar chat must be General').toBe('p_general');
  });

  test('explicit projectId still scopes to that project', async () => {
    const projects = await api<Array<{ id: string; name: string }>>('/projects');
    const real = projects.find((p) => p.id !== 'p_general')!;
    const conv = await api<Conv>('/conversations', { method: 'POST', body: JSON.stringify({ projectId: real.id }) });
    expect(conv.projectId).toBe(real.id);
    await api('/conversations/delete', { method: 'POST', body: JSON.stringify({ ids: [conv.id] }) });
  });
});
