/** R6 image-read: single + two images in one message, both identified. */
import { test } from '@playwright/test';
import { attachAndAsk, pollBody, cleanupMarked, fixture } from './helpers';

test.describe('R6 image-read', () => {
  test.afterAll(cleanupMarked);

  test('single image color', async ({ page }) => {
    await attachAndAsk(page, [fixture('red.png')], 'What solid color is this image? One word.');
    await pollBody(page, /\bred\b/i);
  });

  test('two images, both colors named', async ({ page }) => {
    await attachAndAsk(
      page,
      [fixture('red.png'), fixture('blue.png')],
      'Two images are attached. Name the solid color of each, in order.',
    );
    await pollBody(page, /\bred\b/i);
    await pollBody(page, /\bblue\b/i);
  });
});
