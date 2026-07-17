/**
 * INFRA-1/2 — Phase 1 gate: the SSE recorder/replayer is deterministic.
 *
 * Replays the recorded real pptx transcript through the app's actual SSE
 * consumer and asserts the same terminal UI state every run. Run 3× in a row:
 *   npx playwright test --project=ui-mocked infra-selftest --repeat-each=3
 *
 * Originally these replayed into the conversation the transcript was recorded
 * in (its persisted messages masked the then-unfixed Priority-Zero completion
 * bug). Post FX-2 the live exchange survives on a fresh conversation, and the
 * recorded conversation gets deleted by the [e2e] cleanup sweep anyway — so
 * both tests now run on freshConv like the A0 suite.
 */
import { axiomTest as test, expect } from '../../helpers/fixtures.js';
import { installSseReplay, loadFixture } from '../../helpers/sse-replay.js';
import { ChatPage } from '../../helpers/pom.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/sse/pptx.sse.jsonl');

test('INFRA-1 pptx transcript replays deterministically through the real consumer', async ({ page, freshConv }) => {
  await installSseReplay(page, FIXTURE, { mode: 'normal' });
  const chat = new ChatPage(page);

  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();

  await chat.send('replay: build the kickoff deck');

  // stream runs: live exchange appears, then the artifact card lands
  await expect(chat.liveExchange).toBeVisible();
  await expect(page.locator('[data-testid="artifact-card"][data-kind="pptx"]').first()).toBeVisible({ timeout: 60_000 });

  // terminal state: stream ends and the composer is usable again
  await chat.waitStreamDone(60_000);
  await expect(chat.composer).toBeEditable();

  // determinism probe: exactly one intercepted stream, artifact panel opened
  const replays = await page.evaluate(() => (window as unknown as { __sseReplayCount: number }).__sseReplayCount);
  expect(replays).toBe(1);
  await expect(page.getByTestId('artifact-panel')).toBeVisible();
  await expect(page.getByTestId('artifact-panel')).toHaveAttribute('data-kind', 'pptx');
});

test('INFRA-2 cut mode ends the stream without a done event', async ({ page, freshConv }) => {
  const fixture = loadFixture(FIXTURE);
  const hasDone = fixture.frames.some((f) => f.chunk.includes('event: done'));
  expect(hasDone).toBe(true);

  await installSseReplay(page, FIXTURE, { mode: 'cut' });
  const chat = new ChatPage(page);
  await page.goto(`/c/${freshConv.id}`);
  await chat.composer.waitFor();

  await chat.send('replay: cut stream');
  // replayer mechanics: the stream terminates without `done`; post-FX-2 the
  // app surfaces that as connection loss (asserted in depth by A0-4b)
  await chat.waitStreamDone(60_000);
  await expect(chat.streamError).toBeVisible();
});
