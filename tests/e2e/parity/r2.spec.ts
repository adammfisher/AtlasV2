/** R2 docx-read: table contents verbatim. */
import { test } from '@playwright/test';
import { attachAndAsk, pollBody, cleanupMarked, fixture } from './helpers';

test.describe('R2 docx-read', () => {
  test.afterAll(cleanupMarked);

  test('equipment table returned verbatim (serials)', async ({ page }) => {
    await attachAndAsk(
      page,
      [fixture('manual.docx')],
      'List every row of the Equipment Table verbatim, including serial numbers.',
    );
    await pollBody(page, /BX-441/);
    await pollBody(page, /RL-092/);
    await pollBody(page, /MS-770/);
  });
});
