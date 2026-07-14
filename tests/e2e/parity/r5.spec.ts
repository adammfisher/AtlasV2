/** R5 csv-read: row count, columns, aggregate. Fixture mean temp_c = 14.87.
 * Aggregate tolerance ±0.5: model-computed from full context is acceptable;
 * a truncated-context guess lands far outside and fails → AMBER/RED note. */
import { test } from '@playwright/test';
import { attachAndAsk, pollBody, cleanupMarked, fixture } from './helpers';

test.describe('R5 csv-read', () => {
  test.afterAll(cleanupMarked);

  test('@red row count and column names', async ({ page }) => {
    await attachAndAsk(
      page,
      [fixture('readings.csv')],
      'How many data rows does this CSV have (excluding the header), and what are the column names exactly?',
    );
    await pollBody(page, /1[,.]?200|1200/);
    await pollBody(page, /temp_c/);
    await pollBody(page, /flow_lps/);
  });

  test('@red aggregate: average of temp_c within ±0.5 of 14.87', async ({ page }) => {
    await attachAndAsk(page, [fixture('readings.csv')], 'What is the average of the temp_c column? Give a number.');
    await pollBody(page, /1[45]\.\d/); // 14.x or 15.x — then precision-checked below
    await pollBody(page, /14\.[4-9]\d?|15\.[0-3]\d?/);
  });
});
