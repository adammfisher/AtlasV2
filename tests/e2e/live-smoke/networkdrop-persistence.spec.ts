/**
 * A0-L3 — FX-6 regression lock: an early client disconnect during create_doc
 * generation must always leave a durable, honest record — never silence.
 *
 * Root cause (FIXLOG FX-6): chat.ts's outer catch — the only handler for
 * create_doc/edit_doc failures — skipped persistence entirely whenever
 * `abort.signal.aborted` was true, on the theory that this mirrored a
 * deliberate user Stop. But `res.on('close')` cannot distinguish a Stop click
 * from a genuine network drop, and an abort landing before the model call
 * finishes throws out of runCreateDoc with nothing to show for it — the
 * user's message got answered by nothing, permanently, with no error and no
 * retry affordance surviving a reload.
 *
 * This test drives the abort at the API layer (no browser, no UI reload
 * polling) so it stays fast and precise: A0-L2 covers the same invariant
 * end-to-end through the real UI, at real generation speed; this is its
 * sub-second-verifiable twin, safe to run on every change to this path.
 */
import { test, expect } from '@playwright/test';
import { createConv, cleanupE2E, loginE2E, API, MARK } from '../../helpers/axiom-api.js';
import { lastMessage } from '../../helpers/artifacts.js';

test.afterAll(async () => {
  await cleanupE2E().catch(() => undefined);
});

test('A0-L3 client abort early in create_doc generation persists an honest interrupted message', async () => {
  test.setTimeout(60_000);
  const conv = await createConv();
  const token = await loginE2E();

  const controller = new AbortController();
  const res = await fetch(`${API}/conversations/${conv.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: `${MARK} Build a multi-section landing page prototype for a document automation product`,
      attachments: [],
      retry: false,
      thinking: false,
    }),
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  // read just enough to know the stream is genuinely underway (router step
  // emitted), then abort — this is the worst case: before the model call for
  // the artifact itself has returned anything
  await reader.read();
  await reader.read();
  controller.abort();
  await reader.cancel().catch(() => undefined);

  // poll briefly — the fix persists within ~1s, but give real slack
  let last: Awaited<ReturnType<typeof lastMessage>>;
  const deadline = Date.now() + 30_000;
  do {
    last = await lastMessage(conv.id);
    if (last?.role === 'assistant') break;
    await new Promise((r) => setTimeout(r, 1000));
  } while (Date.now() < deadline);

  expect(last?.role, 'the abort must leave a persisted assistant record, not silence').toBe('assistant');
  expect(last?.kind).toBe('text');
  expect(last?.text ?? '').toMatch(/interrupted|connection|retry/i);
});
