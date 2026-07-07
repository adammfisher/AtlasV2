import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composer, waitIdle, expectReply, cleanupMarked, MARK } from './helpers';

const DIR = path.dirname(fileURLToPath(import.meta.url));

test.describe('uploads', () => {
  test.afterAll(cleanupMarked);

  test('image upload → vision answer', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.locator('input[type="file"]').setInputFiles(path.join(DIR, 'fixtures/red.png'));
    await page.waitForTimeout(2000);
    await composer(page).fill(`${MARK} What solid color is this image? One word.`);
    await composer(page).press('Enter');
    await expectReply(page, /red/i);
  });

  test('multi-file: doc + image answered in one turn, chip download works', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page
      .locator('input[type="file"]')
      .setInputFiles([path.join(DIR, 'fixtures/notes.txt'), path.join(DIR, 'fixtures/red.png')]);
    await page.waitForTimeout(2500);
    await composer(page).fill(`${MARK} What is the fixture codeword, and what color is the image? Brief.`);
    await composer(page).press('Enter');
    await expectReply(page, /KESTREL-42/);
    await waitIdle(page, 30_000);
    // hover download on the persisted chip pulls the original back (S3-backed)
    const chip = page.locator('text=notes.txt').last();
    await chip.hover();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.locator('a[title*="Download notes"]').last().click(),
    ]);
    const file = await download.path();
    expect(readFileSync(file, 'utf8')).toContain('KESTREL-42');
  });
});
