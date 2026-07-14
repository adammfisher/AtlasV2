/**
 * Parity-audit helpers, layered on the base e2e helpers. Audit specs must be
 * evidence-grade: they wait on real UI state (chip presence, stream idle), not
 * fixed sleeps, and they assert on sentinel content baked into the fixtures.
 */
import { type Page, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composer, waitIdle, MARK } from '../helpers';

export { composer, waitIdle, expectReply, cleanupMarked, assistantText, api, MARK } from '../helpers';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const FIX = path.join(DIR, '../fixtures');
export const DFS_DECK = path.join(DIR, '../../../Documentation/DFS Slide Library - 2026.pptx');

export function fixture(name: string): string {
  return path.join(FIX, name);
}

/** Fresh chat, attach files, wait for the UPLOAD RESPONSES (chips render
 * during upload, so chip visibility is not readiness), then send and confirm
 * the message actually left the composer. */
export async function attachAndAsk(page: Page, files: string[], prompt: string, chipTimeout = 120_000): Promise<void> {
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(400);
  // one settled upload round-trip per file: plain POST /api/uploads or the
  // presigned path's POST /api/uploads/finalize — both mean extraction is done
  const settled = Promise.all(
    files.map(() =>
      page.waitForResponse(
        (r) =>
          (r.url().includes('/api/uploads') && !r.url().includes('/presign') && r.request().method() === 'POST' && r.ok()),
        { timeout: chipTimeout },
      ),
    ),
  );
  await page.locator('input[type="file"]').setInputFiles(files);
  await settled;
  for (const f of files) {
    await expect(page.getByText(path.basename(f), { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  }
  const c = composer(page);
  const text = `${MARK} ${prompt}`;
  await c.fill(text);
  // press Enter until the composer actually clears (send can be briefly gated)
  await expect
    .poll(async () => {
      if ((await c.inputValue()) === '') return true;
      await c.press('Enter');
      await page.waitForTimeout(400);
      return (await c.inputValue()) === '';
    }, { timeout: 20_000 })
    .toBe(true);
}

/** Poll the visible transcript until it matches (or the audit times out). */
export async function pollBody(page: Page, pattern: RegExp, timeout = 120_000): Promise<void> {
  await expect
    .poll(async () => (await page.locator('body').innerText()).replace(new RegExp(`\\${MARK}[^\\n]*`, 'g'), ''), { timeout })
    .toMatch(pattern);
}

/** Full visible transcript minus the prompt lines (for negative assertions). */
export async function transcript(page: Page): Promise<string> {
  await waitIdle(page);
  return (await page.locator('body').innerText()).replace(new RegExp(`\\${MARK}[^\\n]*`, 'g'), '');
}
