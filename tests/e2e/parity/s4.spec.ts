/** S4 validator loop: a first pass that FAILS validation must retry with the
 * validator's feedback and land a valid artifact. Deterministic trigger: the
 * mermaid validator rejects unquoted (), and a user demanding parenthesized
 * node labels verbatim makes the first emission fail with high probability —
 * the log proves the repair round actually ran. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { composer, waitIdle, cleanupMarked, api, MARK } from './helpers';

test.describe('S4 validator repair loop', () => {
  test.afterAll(cleanupMarked);

  test('fail → retry with feedback → valid artifact', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await composer(page).fill(
      `${MARK} Create a mermaid flowchart with these exact node labels: "Ingest (S3)", "Transform (Lambda)", "Store (DynamoDB)" — keep the parentheses in every label.`,
    );
    await composer(page).press('Enter');
    await waitIdle(page, 200_000);

    // a valid mermaid artifact must exist despite the hostile labels
    const rows = await api<Array<{ kind: string; created_at: number }>>('/artifacts');
    expect(rows.some((a) => a.kind === 'mermaid' && a.created_at > t0), 'mermaid artifact landed').toBe(true);

    // and the pipeline log shows the repair round fired with validator feedback
    const log = readFileSync(
      `${process.env.HOME}/Library/Application Support/AtlasLocal/logs/pipeline.log`,
      'utf8',
    );
    const recent = log.split('\n').filter((l) => l.includes('repair attempt')).slice(-5).join('\n');
    expect(recent, 'a repair attempt ran (fail → feedback → retry)').toMatch(/repair attempt=\d/);
  });
});
