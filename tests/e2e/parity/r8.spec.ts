/** R8 multi-file: three mixed types in ONE message, all three used. */
import { test } from '@playwright/test';
import { attachAndAsk, pollBody, cleanupMarked, fixture } from './helpers';

test.describe('R8 multi-file', () => {
  test.afterAll(cleanupMarked);

  test('docx + csv + image answered together', async ({ page }) => {
    await attachAndAsk(
      page,
      [fixture('manual.docx'), fixture('readings.csv'), fixture('red.png')],
      'Three files are attached. Tell me: (1) the northern zone codeword from the docx, (2) the third column name of the CSV, (3) the color of the image.',
    );
    await pollBody(page, /HELIOTROPE-9/);
    await pollBody(page, /temp_c/);
    await pollBody(page, /\bred\b/i);
  });
});
