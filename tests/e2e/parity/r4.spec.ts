/** R4 pdf-read: page-specific accuracy + honest degrade on a scanned PDF. */
import { test, expect } from '@playwright/test';
import { attachAndAsk, pollBody, transcript, cleanupMarked, fixture } from './helpers';

test.describe('R4 pdf-read', () => {
  test.afterAll(cleanupMarked);

  test('page-7 table answered correctly', async ({ page }) => {
    await attachAndAsk(
      page,
      [fixture('survey.pdf')],
      'On page 7 of this PDF there is a table. Which cities does it list, and what is the audited site total stated on that page?',
    );
    await pollBody(page, /Osaka/);
    await pollBody(page, /Turin/);
    await pollBody(page, /twenty-six|26/);
  });

  test('scanned PDF: honest no-text-layer statement, no invented summary', async ({ page }) => {
    await attachAndAsk(page, [fixture('scanned.pdf')], 'Summarize this document.');
    const t = await transcript(page);
    // honesty: some statement that the content couldn't be read as text
    expect(t).toMatch(/scan|image|no (readable )?text|couldn'?t (read|extract)|not.*extract|OCR|empty/i);
    // anti-hallucination: the pixels-only sentinel must NOT be "summarized"
    expect(t).not.toMatch(/SCANNED MEMO/);
  });
});
