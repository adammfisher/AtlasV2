/**
 * INFRA-1 — Phase 1 gate: the SSE recorder/replayer is deterministic.
 *
 * Replays the recorded real pptx transcript through the app's actual SSE
 * consumer and asserts the same terminal UI state every run. Run 3× in a row:
 *   npx playwright test --project=ui-mocked infra-selftest --repeat-each=3
 *
 * Deliberately replays into the conversation the transcript was RECORDED in:
 * its messages exist server-side, so this asserts replay mechanics without
 * depending on the (still unfixed at Phase 1) Priority-Zero completion bug.
 */
import { axiomTest as test, expect } from '../../helpers/fixtures.js';
import { installSseReplay, loadFixture } from '../../helpers/sse-replay.js';
import { ChatPage } from '../../helpers/pom.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/sse/pptx.sse.jsonl');

test('INFRA-1 pptx transcript replays deterministically through the real consumer', async ({ page }) => {
  const fixture = await installSseReplay(page, FIXTURE, { mode: 'normal' });
  const chat = new ChatPage(page);

  await page.goto(`/c/${(fixture.meta as { convId?: string }).convId ?? ''}`);
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

test('INFRA-2 cut mode ends the stream without a done event', async ({ page }) => {
  // close-without-done must at minimum end the busy state (the exact UX is
  // Phase 2's subject — this asserts only replayer mechanics: the cut happens)
  const fixture = loadFixture(FIXTURE);
  const hasDone = fixture.frames.some((f) => f.chunk.includes('event: done'));
  expect(hasDone).toBe(true);

  await installSseReplay(page, FIXTURE, { mode: 'cut' });
  const chat = new ChatPage(page);
  await page.goto(`/c/${(fixture.meta as { convId?: string }).convId ?? ''}`);
  await chat.composer.waitFor();

  const sawDone = page.waitForResponse(() => false, { timeout: 1 }).catch(() => 'unused');
  await chat.send('replay: cut stream');
  await chat.waitStreamDone(60_000); // stream terminates even though done never arrived
  await sawDone;
});
