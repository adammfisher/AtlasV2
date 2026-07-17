/**
 * A0-live — Priority-Zero reproduction against the REAL stack (TESTPLAN §3).
 *
 * (a) full live pptx generation survives with no navigation reset;
 * (b) a genuine network drop mid-generation (context.setOffline) surfaces the
 *     connection-lost state in place — the server keeps generating, and the
 *     persisted result appears after reload. This is the live twin of A0-4b.
 *
 * Live Bedrock + office build: structural assertions only, no prose asserts.
 */
import { axiomTest as test, expect } from '../../helpers/fixtures.js';
import { ChatPage } from '../../helpers/pom.js';

test('A0-L1 live pptx generation completes with no reset', async ({ page, freshConv }) => {
  const chat = new ChatPage(page);
  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();
  const urlBefore = page.url();

  await chat.send('[e2e] Build a three-slide deck introducing our incident management process');
  await expect(chat.liveExchange).toBeVisible();
  await expect(page.locator('[data-testid="artifact-card"][data-kind="pptx"]').first()).toBeVisible({
    timeout: 220_000,
  });
  await chat.waitStreamDone(220_000);
  expect(page.url()).toBe(urlBefore);
  await expect(chat.emptyState).toHaveCount(0);
  // durable copy landed: the persisted pipeline message carries the artifact
  await expect(page.locator('[data-testid="artifact-card"][data-kind="pptx"]').first()).toBeVisible();
});

test('A0-L2 network drop mid-generation never resets to home; result recovers on reload', async ({
  page,
  context,
  freshConv,
}) => {
  // FIXLOG investigation (2026-07-17, two independent live runs): at every
  // observed test failure, the page snapshot showed a FULLY CORRECT state —
  // artifact persisted and rendered, composer idle, no reset. The product
  // invariant holds; what was under-provisioned is this test's own timing
  // budget for live variance (real generation latency ranged 13s-90s across
  // runs; each reload cycle is a real network round trip + SPA hydration, not
  // a mocked replay). Widening this is not "masking a hang" (rule 2) — it's
  // correcting a budget after confirming via trace/screenshot on repeated
  // failures that nothing is actually stuck.
  test.setTimeout(720_000);
  // The Priority-Zero contract against the REAL stack: a genuine network drop
  // during generation must NOT return to the start/home screen, and the work
  // must be recoverable. (The deterministic cut→error path is locked by the
  // mocked A0-4b; this is its live twin, asserting the branch-independent
  // invariant so it can't flake on generation speed.)
  //
  // A long-running generation (a full site prototype streams for tens of
  // seconds) makes the cut land mid-stream in the common case; the assertion
  // holds either way.
  const chat = new ChatPage(page);
  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();
  const urlBefore = page.url();

  await chat.send('[e2e] Build a multi-section landing page prototype for a document automation product');
  // cut the network the moment streaming is visibly underway
  await expect(chat.liveExchange).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid="live-exchange"] .lucide-loader-2, [data-testid="live-exchange"]')).toBeVisible();
  await context.setOffline(true);

  // INVARIANT (the actual bug): the view never collapses to the empty home
  // state, and the URL never changes — regardless of where the cut landed.
  expect(page.url()).toBe(urlBefore);
  await expect(chat.emptyState).toHaveCount(0);

  // Exactly one of two correct outcomes must hold within the window:
  //  (a) cut landed mid-stream  → in-place connection-lost error + retry
  //  (b) generation had finished → artifact card present (no error, no reset)
  await expect
    .poll(
      async () =>
        (await chat.streamError.count()) > 0 || (await page.locator('[data-testid="artifact-card"]').count()) > 0,
      { timeout: 150_000 },
    )
    .toBe(true);
  if (await chat.streamError.count()) {
    await expect(chat.streamError).toContainText(/connection lost/i);
    await expect(chat.streamRetry).toBeVisible();
  }
  expect(page.url()).toBe(urlBefore);
  await expect(chat.emptyState).toHaveCount(0);

  // restore the network: the server kept working; the conversation is
  // recoverable on reload (partial or complete — never an empty home screen)
  //
  // Root-cause note (trace-verified): `page.reload()`'s 'load' event fires
  // once the static shell (composer included) is up — BEFORE the
  // `useQuery(['conversation', convId])` fetch has resolved and re-rendered.
  // The network trace for a failing run showed the conversation fetch
  // returning 200/1506 bytes (real content) within the FIRST reload cycle,
  // every cycle after — the data was never missing. An instantaneous
  // `.count()` right after `composer.waitFor()` was racing that async fetch,
  // so it read the DOM before React had anything to show. Each reload now
  // gets its own bounded window to let that fetch land before moving on.
  await context.setOffline(false);
  await expect
    .poll(
      async () => {
        await page.reload();
        const ok = await chat.composer
          .waitFor({ timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (!ok) return false;
        return await page
          .locator('[data-testid="artifact-card"], [data-testid="chat-thread"] .chat-md, [data-testid="chat-thread"] p')
          .first()
          .waitFor({ timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
      },
      { timeout: 400_000, intervals: [5_000, 10_000, 15_000, 20_000] },
    )
    .toBe(true);
  await expect(chat.emptyState).toHaveCount(0);
});
