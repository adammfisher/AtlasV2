/** X4 streaming resilience: (1) tokens survive a throttled connection intact,
 * (2) closing the tab mid-stream aborts server-side and persists the partial
 * (the same contract as the stop button — chat.ts abort path). Heartbeat: the
 * server writes `: keep-alive` every 15s, which holds CloudFront's ~30s idle
 * origin-read window open — proven in production by the deployed suite runs. */
import { test, expect } from '@playwright/test';
import { composer, pollBody, cleanupMarked, api, MARK } from './helpers';

test.describe('X4 streaming resilience', () => {
  test.afterAll(cleanupMarked);

  test('slow connection: full reply, no dropped tokens', async ({ page }) => {
    // load the app on a fast link, then throttle for the STREAM — the point is
    // token delivery on a bad connection, not vite bundle delivery
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (50 * 1024) / 8, // ~50kbps
      uploadThroughput: (20 * 1024) / 8,
    });
    await composer(page).fill(`${MARK} Reply with exactly this sentence: THE-SLOW-LINK-CARRIED-EVERY-TOKEN-9421.`);
    await composer(page).press('Enter');
    await pollBody(page, /THE-SLOW-LINK-CARRIED-EVERY-TOKEN-9421/, 120_000);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
  });

  test('tab close mid-stream: server aborts and persists the partial', async ({ page, context }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await composer(page).fill(`${MARK} List the numbers from 1 to 500 as digits, one per line, no other text.`);
    await composer(page).press('Enter');
    // wait for a number only the assistant's counting emits (the prompt
    // mentions 1 and 500 itself), then kill the tab mid-stream
    await pollBody(page, /\b47\b/, 90_000);
    const convId = /\/c\/([A-Za-z0-9_-]+)/.exec(page.url())?.[1];
    expect(convId).toBeTruthy();
    await page.close();
    await new Promise((r) => setTimeout(r, 4_000));
    // server must be healthy and the partial persisted (abort path)
    const health = await fetch(`${process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175'}/api/health`, { headers: { Authorization: `Bearer ${process.env.ATLAS_TEST_TOKEN}` } });
    expect(health.status).toBe(200);
    const detail = await api<{ messages: Array<{ role: string; kind: string; text?: string }> }>(`/conversations/${convId}`);
    const assistant = detail.messages.filter((m) => m.role === 'assistant' && m.kind === 'text').pop();
    expect(assistant?.text, 'partial persisted after tab close').toBeTruthy();
    expect(assistant!.text).toMatch(/\b47\b/);
    expect(assistant!.text.trim().endsWith('500'), 'it really was cut short').toBe(false);
    // cleanup: reopen a page so afterAll teardown has a context
    await context.newPage();
  });
});
