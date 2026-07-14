/** R3 xlsx-read: per-sheet awareness + cell-level formula question.
 * Note: openpyxl-written files carry no cached formula values, so "what does
 * B4 compute" requires either the formula text (=SUM(B2:B3)) or the computed
 * 36 — both accepted; neither present is a RED. */
import { test } from '@playwright/test';
import { attachAndAsk, pollBody, cleanupMarked, fixture } from './helpers';

test.describe('R3 xlsx-read', () => {
  test.afterAll(cleanupMarked);

  test('sheet 2 contents + B4 formula', async ({ page }) => {
    await attachAndAsk(
      page,
      [fixture('model.xlsx')],
      'What is in sheet 2 of this workbook, and what does the formula in cell B4 of that sheet compute?',
    );
    await pollBody(page, /Headcount/i);
    await pollBody(page, /Platform/i);
    await pollBody(page, /SUM\(B2:B3\)|=B2\s*\+\s*B3|\b36\b|total.*(head\s*count|count)/i);
  });

  test('sheet 3 sentinel proves all sheets extracted', async ({ page }) => {
    await attachAndAsk(page, [fixture('model.xlsx')], 'What text is in the third sheet?');
    await pollBody(page, /XLSX-SHEET3-OSPREY/);
  });
});
