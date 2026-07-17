/**
 * A0-* — Priority-Zero regression suite (TESTPLAN §3, FIXLOG FX-2..FX-5).
 *
 * The reported bug: the app returned to the start/home screen before artifact
 * generation completed. Root causes fixed: close-without-done treated as
 * success (FX-2), new-chat promotion race (FX-3), stream tied to component
 * lifetime (FX-2), swallowed mid-stream errors (FX-4), per-chunk render jank
 * (FX-5). These specs replay REAL recorded transcripts through the real SSE
 * consumer via the fetch-patch replayer — deterministic, no model calls.
 */
import { atlasTest as test, expect } from '../../helpers/fixtures.js';
import { installSseReplay } from '../../helpers/sse-replay.js';
import { ChatPage } from '../../helpers/pom.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SSE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/sse');
const KINDS = ['pptx', 'docx', 'xlsx', 'pdf', 'md', 'mermaid', 'svg', 'react', 'site'] as const;

for (const kind of KINDS) {
  test(`A0-1 [${kind}] view and URL survive the full stream; artifact renders`, async ({ page, freshConv }) => {
    await installSseReplay(page, path.join(SSE, `${kind}.sse.jsonl`), { mode: 'normal' });
    const chat = new ChatPage(page);
    await page.goto(`/c/${freshConv.id}`);
    await chat.composer.waitFor();
    const urlBefore = page.url();

    await chat.send(`create the ${kind} artifact`);
    await expect(chat.liveExchange).toBeVisible();

    // the URL and top-level chat view must never change until terminal
    await expect(page.locator(`[data-testid="artifact-card"][data-kind="${kind}"]`).first()).toBeVisible({
      timeout: 90_000,
    });
    expect(page.url()).toBe(urlBefore);
    await expect(chat.thread).toBeVisible();
    await expect(chat.emptyState).toHaveCount(0);

    await chat.waitStreamDone(90_000);
    // terminal state: still on the same conversation, exchange still on
    // screen (never collapses to the empty home state), composer usable
    expect(page.url()).toBe(urlBefore);
    await expect(chat.emptyState).toHaveCount(0);
    await expect(chat.liveExchange.or(page.locator('[data-testid="artifact-card"]').first())).toBeVisible();
    await expect(chat.composer).toBeEditable();
    await expect(page.getByTestId('artifact-panel')).toHaveAttribute('data-kind', kind);
  });
}

test('A0-2 long-stream survival: ~3-minute mocked stream completes with no reset', async ({ page, freshConv }) => {
  // pptx transcript is ~18.5s; ×10 ≈ 185s of continuous streaming
  await installSseReplay(page, path.join(SSE, 'pptx.sse.jsonl'), { mode: 'slow', slowFactor: 10 });
  const chat = new ChatPage(page);
  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();
  const urlBefore = page.url();

  await chat.send('long build');
  await expect(chat.liveExchange).toBeVisible();
  await expect(page.locator('[data-testid="artifact-card"][data-kind="pptx"]').first()).toBeVisible({
    timeout: 280_000,
  });
  await chat.waitStreamDone(280_000);
  expect(page.url()).toBe(urlBefore);
  await expect(chat.emptyState).toHaveCount(0);
});

test('A0-3 mid-stream interaction does not kill the stream', async ({ page, freshConv }) => {
  await installSseReplay(page, path.join(SSE, 'pptx.sse.jsonl'), { mode: 'slow', slowFactor: 3 });
  const chat = new ChatPage(page);
  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();

  await chat.send('build it');
  await expect(chat.liveExchange).toBeVisible();

  // scroll the thread, open the artifact drawer, and type a draft mid-stream
  await chat.thread.evaluate((el) => el.scrollTo(0, 0));
  await page.getByTestId('artifact-list-btn').click();
  await expect(page.getByTestId('artifact-drawer')).toBeVisible();
  await chat.composer.pressSequentially('a draft I am typing while it streams', { delay: 20 });

  await expect(page.locator('[data-testid="artifact-card"][data-kind="pptx"]').first()).toBeVisible({
    timeout: 120_000,
  });
  await chat.waitStreamDone(120_000);
  // the draft survived and the view never reset
  await expect(chat.composer).toHaveValue('a draft I am typing while it streams');
  await expect(chat.emptyState).toHaveCount(0);
});

test('A0-4a mid-stream error event surfaces in place — never navigates home', async ({ page, freshConv }) => {
  await installSseReplay(page, path.join(SSE, 'pptx.sse.jsonl'), { mode: 'error', errorMessage: 'mock pipeline failure' });
  const chat = new ChatPage(page);
  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();
  const urlBefore = page.url();

  await chat.send('build it');
  await expect(chat.streamError).toBeVisible({ timeout: 60_000 });
  await expect(chat.streamError).toContainText('mock pipeline failure');
  await expect(chat.streamRetry).toBeVisible();
  expect(page.url()).toBe(urlBefore);
  await expect(chat.emptyState).toHaveCount(0);
  // composer unlocks so the user can act
  await expect(chat.idle).toBeVisible({ timeout: 20_000 });
});

test('A0-4b connection drop (close without done) surfaces connection loss in place', async ({ page, freshConv }) => {
  await installSseReplay(page, path.join(SSE, 'pptx.sse.jsonl'), { mode: 'cut' });
  const chat = new ChatPage(page);
  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();
  const urlBefore = page.url();

  await chat.send('build it');
  // pre-fix behavior: silent success + collapse to the empty home state.
  // fixed behavior: an explicit connection-lost error, in place, with retry.
  await expect(chat.streamError).toBeVisible({ timeout: 60_000 });
  await expect(chat.streamError).toContainText(/connection lost/i);
  await expect(chat.streamRetry).toBeVisible();
  expect(page.url()).toBe(urlBefore);
  await expect(chat.emptyState).toHaveCount(0);
  await expect(chat.idle).toBeVisible({ timeout: 20_000 });
});

test('A0-5 jank: UI stays interactive mid-stream; long tasks logged', async ({ page, freshConv }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: Array<{ duration: number }> };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push({ duration: e.duration });
    }).observe({ entryTypes: ['longtask'] });
  });
  await installSseReplay(page, path.join(SSE, 'site.sse.jsonl'), { mode: 'normal', maxGapMs: 40 });
  const chat = new ChatPage(page);
  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();

  await chat.send('build the site');
  await expect(chat.liveExchange).toBeVisible();

  // hard gate: a mid-stream click must respond within 1s
  const t0 = Date.now();
  await page.getByTestId('artifact-list-btn').click();
  await expect(page.getByTestId('artifact-drawer')).toBeVisible({ timeout: 1_000 });
  const clickMs = Date.now() - t0;

  await chat.waitStreamDone(120_000);
  const tasks = await page.evaluate(() => (window as unknown as { __longTasks: Array<{ duration: number }> }).__longTasks);
  const over200 = tasks.filter((t) => t.duration > 200);
  const blockedMs = Math.round(tasks.reduce((a, t) => a + t.duration, 0));
  // logged for the user (TESTPLAN A0-5): not hard-gated, by design
  console.log(
    `A0-5 jank report: ${tasks.length} long tasks total, ${over200.length} over 200ms, ~${blockedMs}ms main-thread blocked, mid-stream click responded in ${clickMs}ms`,
  );
  expect(clickMs).toBeLessThan(1_000);
});
