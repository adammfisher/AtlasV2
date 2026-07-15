/** X5 error recovery: a failed generation shows an honest error WITH a Retry
 * affordance; retrying after the cause clears succeeds and the composer
 * recovers. Error is forced deterministically via a Bedrock disconnect
 * (selecting an invalid model id fails the request fast). */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, api, MARK } from './helpers';

test.describe('X5 error recovery', () => {
  test.afterAll(async () => {
    // afterAll safety net — never leave Bedrock disconnected
    await api('/models/bedrock/connect', { method: 'POST', body: '{}' }).catch(() => undefined);
    await cleanupMarked();
  });

  test('mid-request failure → error + Retry → recovery', async ({ page }) => {
    // arrange a failing backend: disconnect Bedrock — the chat route throws
    // 'No model connected' immediately (unknown model ids self-heal, so they
    // cannot serve as the failure trigger)
    await api('/models/bedrock/disconnect', { method: 'POST', body: '{}' });

    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await composer(page).fill(`${MARK} Reply with exactly RECOVERY-CHECK`);
    await composer(page).press('Enter');

    // honest error surfaced in the transcript, with a retry affordance
    // (persisted errors carry the standard regenerate control; live stream
    // errors additionally show an inline Retry button)
    await pollBody(page, /Something went wrong|No model connected/i, 60_000);
    const retry = page.locator('button[title*="egenerate"], button[title*="etry"], button:has(svg.lucide-refresh-cw)').last();
    await expect(retry, 'Retry affordance on error').toBeVisible({ timeout: 10_000 });

    // clear the cause, retry, succeed
    await api('/models/bedrock/connect', { method: 'POST', body: '{}' });
    await retry.click();
    await pollBody(page, /RECOVERY-CHECK/, 90_000);
    await waitIdle(page, 30_000);
    await expect(composer(page)).toBeEnabled();
  });
});
