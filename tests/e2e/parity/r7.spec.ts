/** R7 code/text-read: JSON structure read precisely. */
import { test } from '@playwright/test';
import { attachAndAsk, pollBody, cleanupMarked, fixture } from './helpers';

test.describe('R7 code-text-read', () => {
  test.afterAll(cleanupMarked);

  test('json: nested sentinel + endpoint count', async ({ page }) => {
    await attachAndAsk(
      page,
      [fixture('config.json')],
      'In this JSON: what is the value of flags.sentinel, and how many endpoints are defined?',
    );
    await pollBody(page, /JSON-NIGHTJAR-77/);
    await pollBody(page, /\b(two|2)\b/i);
  });
});
