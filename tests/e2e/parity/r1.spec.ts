/** R1 pptx-read: content, not filename. Small deck asserts chart data reaches
 * the model; the 22MB DFS deck exercises the large-upload path + slide addressing. */
import { test } from '@playwright/test';
import { attachAndAsk, pollBody, cleanupMarked, fixture, DFS_DECK } from './helpers';

test.describe('R1 pptx-read', () => {
  test.afterAll(cleanupMarked);

  test('small deck: slide-by-slide summary carries real slide content', async ({ page }) => {
    await attachAndAsk(
      page,
      [fixture('deck-small.pptx')],
      'Summarize this deck slide by slide. Include the numbers shown on any charts.',
    );
    // slide 4 bullets + slide 3/5 chart series — these only exist inside the file
    await pollBody(page, /Pipeline by segment|Mid-market/i);
    await pollBody(page, /4\.2|win rate/i);
  });

  test('full DFS deck (22MB): slide 5 title answered from extraction', async ({ page }) => {
    await attachAndAsk(
      page,
      [DFS_DECK],
      'What is the title of slide 5 of this deck? Answer with the title only.',
      300_000, // 22MB upload + 286-slide extraction
    );
    await pollBody(page, /Tips\s*&\s*Shortcuts/i, 180_000);
  });
});
