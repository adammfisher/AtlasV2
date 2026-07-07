import { test, expect } from '@playwright/test';
import { composer, sendNew, send, waitIdle, expectReply, cleanupMarked, assistantText, api, MARK } from './helpers';

test.describe('chat core @fast', () => {
  test.afterAll(cleanupMarked);

  test('streams a reply and recovers the composer', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Reply with exactly: E2E-STREAM-OK');
    await expectReply(page, /E2E-STREAM-OK/);
    await expect(composer(page)).toBeEnabled();
  });

  test('stop aborts, keeps the partial, and the next send works', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'List the numbers one to forty as words, one per line, no other text.');
    await page.waitForTimeout(6000);
    await page.locator('button:has(svg.lucide-square)').last().click();
    await page.waitForTimeout(2500);
    const t = await assistantText(page);
    expect(t).toMatch(/\bone\b/i); // partial persisted
    await send(page, 'Reply with exactly: AFTER-STOP-OK');
    await expectReply(page, /AFTER-STOP-OK/);
  });

  test('copy, regenerate and feedback controls render on assistant messages', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Say exactly: ERGONOMICS-OK');
    await expectReply(page, /ERGONOMICS-OK/);
    await expect(page.locator('button[title="Copy"]').last()).toBeVisible();
    await expect(page.locator('button[title="Regenerate response"]').last()).toBeVisible();
    // thumbs toggle persists
    await page.locator('button[title="Good response"]').last().click();
    await expect
      .poll(async () => page.locator('button[title="Good response"]').last().evaluate((el) => getComputedStyle(el).color))
      .not.toBe('rgb(133, 130, 122)'); // no longer mute
  });

  test('regenerate replaces the last response without duplicating the user turn', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Give me one random fruit name.');
    await waitIdle(page, 60_000);
    await page.locator('button[title="Regenerate response"]').last().click();
    await waitIdle(page, 60_000);
    // authoritative check: exactly one user turn, exactly one (fresh) response
    const convs = await api<Array<{ id: string; title: string }>>('/conversations');
    const conv = convs.find((c) => c.title.includes('random fruit'));
    expect(conv).toBeTruthy();
    const detail = await api<{ messages: Array<{ role: string }> }>(`/conversations/${conv!.id}`);
    expect(detail.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(detail.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
  });

  test('edit message truncates and regenerates', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Say exactly: BEFORE-EDIT');
    await expectReply(page, /BEFORE-EDIT/);
    await page.locator('.group\\/msg').last().hover();
    await page.locator('button[title*="Edit message"]').last().click({ force: true });
    await expect(page.getByText(/Editing message/)).toBeVisible();
    await composer(page).fill(`${MARK} Say exactly: AFTER-EDIT`);
    await composer(page).press('Enter');
    await expectReply(page, /AFTER-EDIT/);
    expect(await assistantText(page)).not.toContain('BEFORE-EDIT');
  });

  test('extended thinking streams a reasoning block', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.locator('button[title*="thinking"]').first().click();
    await send(page, 'Is 391 divisible by 17? Work it out.');
    await expect(page.getByText('Thinking', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await waitIdle(page, 90_000);
  });

  test('chat export downloads markdown', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Say exactly: EXPORT-ME');
    await expectReply(page, /EXPORT-ME/);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.locator('button[title="Export chat as Markdown"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });
});
