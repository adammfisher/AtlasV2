/** ULTRA code generation: generated code must be CORRECT, not just rendered —
 * extract the emitted code block and execute it (venv python / node), assert
 * the computed output. */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composer, cleanupMarked, MARK } from './helpers';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TMP = mkdtempSync(path.join(tmpdir(), 'codegen-'));

async function generatedCode(page: import('@playwright/test').Page, prompt: string): Promise<string> {
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await composer(page).fill(`${MARK} ${prompt}`);
  await composer(page).press('Enter');
  await expect.poll(() => page.locator('.chat-md pre code').count(), { timeout: 120_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  return (await page.locator('.chat-md pre code').last().innerText()).trim();
}

test.describe('ULTRA code generation', () => {
  test.describe.configure({ retries: 2 }); // model-nondeterministic routing/output
  test.afterAll(cleanupMarked);
  test.setTimeout(300_000);

  test('python: generated function executes and returns the right answer', async ({ page }) => {
    const code = await generatedCode(
      page,
      'Show me right here in chat (not as a document): a python function is_prime(n) using trial division, then print("PRIMES=" + str(sum(x for x in range(50) if is_prime(x)))). ONE python code block, no commentary.',
    );
    const file = path.join(TMP, 'gen.py');
    writeFileSync(file, code);
    const out = execFileSync(path.join(ROOT, 'runtimes/python/venv/bin/python'), [file], {
      encoding: 'utf8',
      timeout: 30_000,
    }).trim();
    expect(out, 'sum of primes below 50').toContain('PRIMES=328');
  });

  test('javascript: generated function executes and returns the right answer', async ({ page }) => {
    const code = await generatedCode(
      page,
      'Show me right here in chat (not as a document): a JavaScript iterative function fib(n) with fib(1)=1 and fib(2)=1, then console.log("FIB=" + fib(20)). ONE javascript code block, no commentary.',
    );
    const file = path.join(TMP, 'gen.mjs');
    writeFileSync(file, code);
    const out = execFileSync('node', [file], { encoding: 'utf8', timeout: 30_000 }).trim();
    expect(out, 'fib(20)').toContain('FIB=6765');
  });
});
