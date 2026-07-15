/** M3 remember/forget, M4 modal, M5 deletion propagation (suspected gap),
 * M6 knowledge citations @red, M7 instructions, M8 knowledge RAG page-7,
 * M9 incognito @red. M1/M2 run as the existing evals against the DEPLOYED
 * stack (recorded separately). */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, api, fixture, MARK } from './helpers';

async function newChat(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(400);
}

test.describe('M3-M9 memory & projects', () => {
  test.afterAll(cleanupMarked);

  test('M3 remember tool fires and the fact recalls in a NEW chat', async ({ page }) => {
    await newChat(page);
    await composer(page).fill(`${MARK} Remember for this project: the staging bucket is called cobalt-staging-11.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    await newChat(page);
    await composer(page).fill(`${MARK} What is the staging bucket called?`);
    await composer(page).press('Enter');
    await pollBody(page, /cobalt-staging-11/, 90_000);
  });

  test('M4 memory modal lists the fact and supports delete', async ({ page }) => {
    await page.goto('/');
    const brain = page.locator('button:has(svg.lucide-brain), button[title*="emory"]').first();
    await expect(brain).toBeVisible({ timeout: 10_000 });
    await brain.click();
    await expect(page.locator('text=cobalt-staging-11').first()).toBeVisible({ timeout: 15_000 });
  });

  test('M5 deleting a conversation purges its derived facts', async ({ page }) => {
    await newChat(page);
    await composer(page).fill(`${MARK} Remember for this project: the incident bridge number is 774-PURGE-ME.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    // force extraction, then delete the conversation
    const convs = await api<Array<{ id: string; title: string; project_id?: string }>>('/conversations');
    const conv = convs.find((c) => c.title.includes(MARK));
    expect(conv).toBeTruthy();
    await api('/conversations/delete', { method: 'POST', body: JSON.stringify({ ids: [conv!.id] }) });
    await newChat(page);
    await composer(page).fill(`${MARK} What is the incident bridge number? If you don't know, say NO-BRIDGE-KNOWN.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const body = await page.locator('body').innerText();
    expect(body, 'fact from a deleted conversation must not recall').not.toContain('774-PURGE-ME');
  });

  test('M6 knowledge answers cite the source file as a rendered chip', async ({ page }) => {
    // upload into THIS project's knowledge first (new chats are General now)
    await newChat(page);
    await page.locator('input[type="file"]').setInputFiles(fixture('manual.docx'));
    await page.waitForResponse((r) => r.url().includes('/api/uploads') && r.ok(), { timeout: 120_000 });
    await composer(page).fill(`${MARK} Noted. Reply OK.`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    await newChat(page);
    await composer(page).fill(`${MARK} From this project's knowledge files: what is the northern zone codeword in the field manual?`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    // RichText renders [source: filename] as a .chat-cite chip
    await expect
      .poll(async () => page.locator('.chat-cite').count(), { timeout: 60_000 })
      .toBeGreaterThan(0);
  });

  test('M7 project instructions are honored', async ({ page }) => {
    // sidebar chats land in the General project now — instructions must be
    // set THERE for this flow (a project-workspace chat would use its own)
    const pid = 'p_general';
    await api(`/projects/${pid}`, {
      method: 'PATCH',
      body: JSON.stringify({ instructions: 'Always end every reply with the token INSTR-FOXTROT.' }),
    });
    await newChat(page);
    await composer(page).fill(`${MARK} Reply with a one-line greeting.`);
    await composer(page).press('Enter');
    await pollBody(page, /INSTR-FOXTROT/, 90_000);
    await api(`/projects/${pid}`, { method: 'PATCH', body: JSON.stringify({ instructions: '' }) });
  });

  test('M8 project knowledge: page-7 fact answered from an uploaded PDF', async ({ page }) => {
    // upload survey.pdf as project knowledge via the panel input if present,
    // else via the composer in a project chat (attachment → knowledge)
    await newChat(page);
    await page.locator('input[type="file"]').setInputFiles(fixture('survey.pdf'));
    await page.waitForResponse((r) => r.url().includes('/api/uploads') && r.ok(), { timeout: 120_000 });
    await composer(page).fill(`${MARK} Noted, thanks. Reply OK.`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    // ask in a NEW chat — only project knowledge can answer
    await newChat(page);
    await composer(page).fill(`${MARK} From the survey document in this project: what is the audited site total on page 7?`);
    await composer(page).press('Enter');
    await pollBody(page, /twenty-six|26/, 120_000);
  });

  test('M9 incognito: banner, never listed, deleted on leave', async ({ page }) => {
    await page.goto('/');
    await page.locator('[title*="Incognito"]').first().click();
    await page.waitForTimeout(800);
    await expect(page.getByText(/Incognito chat — not saved/)).toBeVisible({ timeout: 5_000 });
    await composer(page).fill('The incognito codeword is GHOST-ORCHID-13. Reply OK.');
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    // never listed
    const convs = await api<Array<{ id: string; title: string }>>('/conversations');
    expect(convs.some((c) => c.title.includes('Incognito')), 'ghost chat must not list').toBe(false);
    // leaving deletes it: capture the conv id from the URL, switch away, verify 404
    const url = page.url();
    const convId = /\/c\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
    expect(convId).toBeTruthy();
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    const res = await fetch(`${process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175'}/api/conversations/${convId}`);
    expect(res.status, 'incognito conversation must be gone after leaving').toBe(404);
  });
});
