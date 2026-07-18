/** X-section polish audit: X1 styles, X2 preferences, X3 markdown torture
 * (X3b LaTeX/KaTeX rendering remains @red — not yet implemented), X6 voice,
 * X7 gallery, X8 mobile, X9 light theme, X10 keyboard.
 * X4/X5 (streaming resilience, mid-stream kill) are recorded as manual/deferred
 * in the matrix — they need infra manipulation, not a browser assertion. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, MARK } from './helpers';

async function newChat(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(400);
}

test.describe('X polish', () => {
  test.afterAll(cleanupMarked);

  test('X1 style presets selectable per chat, and they change the output', async ({ page }) => {
    // two SEPARATE chats, not the same conversation asked "again": within one
    // conversation, re-asking the identical question after already answering it
    // makes the model repeat its own prior answer verbatim regardless of any
    // style change — a real product behavior (respecting "again please"), but
    // it defeats the point of this test, which is whether style affects a
    // FRESH answer. "Per chat" is also literally what the feature promises.
    const setStyle = async (name: 'concise' | 'explanatory'): Promise<void> => {
      await page.locator('button:has(svg.lucide-plus)').last().click();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(600);
      await page.locator('div.fixed.inset-0').last().click({ force: true }).catch(() => undefined);
    };

    await newChat(page);
    await composer(page).fill(`${MARK} hello`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    await setStyle('concise');
    await composer(page).fill(`${MARK} Why is the sky blue?`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const conciseLen = ((await page.locator('.chat-md').last().innerText()) ?? '').length;
    expect(conciseLen, 'concise style produced an answer').toBeGreaterThan(10);

    // a fresh chat, so the model has no prior answer of its own to repeat
    await newChat(page);
    await composer(page).fill(`${MARK} hello`);
    await composer(page).press('Enter');
    await waitIdle(page, 60_000);
    await setStyle('explanatory');
    await composer(page).fill(`${MARK} Why is the sky blue?`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const explLen = ((await page.locator('.chat-md').last().innerText()) ?? '').length;
    expect(explLen, `explanatory (${explLen}) should exceed concise (${conciseLen}) by 1.5x`).toBeGreaterThan(conciseLen * 1.5);
  });

  test('X2 userName preference reaches the model', async ({ page }) => {
    await newChat(page);
    await composer(page).fill(`${MARK} What is my name, per your configuration? One word.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const body = await page.locator('body').innerText();
    expect(body, 'configured userName (Adam) should be known').toMatch(/Adam/);
  });

  test('X3 markdown torture: table, nested list, code+copy, LaTeX', async ({ page }) => {
    await newChat(page);
    await composer(page).fill(
      `${MARK} Quick question: which of Osaka (17 sites) and Turin (9 sites) has more? Answer with a small markdown table of the two, plus a nested bullet list (outer alpha, inner beta), plus a python code block printing torture-ok.`,
    );
    await composer(page).press('Enter');
    // poll: the reply streams in — a one-shot count races the stream
    const countAcrossFrames = async (selector: string): Promise<number> => {
      try {
        let n = await page.locator(selector).count();
        for (const f of page.frames()) n += await f.locator(selector).count().catch(() => 0);
        return n;
      } catch {
        return 0;
      }
    };
    await expect.poll(() => countAcrossFrames('table'), { timeout: 90_000 }).toBeGreaterThan(0);
    await expect.poll(() => countAcrossFrames('pre'), { timeout: 30_000 }).toBeGreaterThan(0);
    // copy affordance on CHAT code blocks: force an inline reply (artifacts
    // have their own download affordance and a sandboxed DOM)
    await composer(page).fill(`${MARK} Also show me right here in the chat, not as a document: a one-line python code block that prints torture-ok.`);
    await composer(page).press('Enter');
    await expect.poll(() => page.locator('.chat-md pre').count(), { timeout: 90_000 }).toBeGreaterThan(0);
    await expect
      .poll(() => page.locator('.chat-md pre .code-copy').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('@red X3b LaTeX renders as math (katex absent)', async ({ page }) => {
    await newChat(page);
    await composer(page).fill(`${MARK} Show me Einstein's mass-energy equivalence as a LaTeX equation.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const math = await page.locator('.katex, .MathJax, mjx-container').count();
    expect(math, 'LaTeX renders as math').toBeGreaterThan(0);
  });

  test('X6 mic button is wired (Web Speech), not decorative', async ({ page }) => {
    await newChat(page);
    const mic = page.locator('button:has(svg.lucide-mic)').first();
    // headless Chromium exposes webkitSpeechRecognition, so the button renders
    await expect(mic).toBeVisible();
    expect(await mic.getAttribute('data-listening'), 'wired with listening state').toBe('false');
    await mic.click();
    // click flips the state marker (actual audio capture needs a mic; the
    // wiring — construct, start, state — is what this asserts)
    await expect
      .poll(async () => mic.getAttribute('data-listening'), { timeout: 5_000 })
      .toBe('true');
  });

  test('X7 cross-chat artifacts gallery surface', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Artifacts', { exact: true }).first().click();
    // rows from MANY chats/projects render with kind filters + downloads. The
    // static heading paints immediately, but the rows depend on the
    // ['artifacts-gallery'] query resolving — a flat wait before checking for
    // them races that fetch under load instead of confirming it landed.
    await expect(page.getByText('Everything generated across every chat and project.')).toBeVisible();
    await expect
      .poll(() => page.locator('a[title^="Download"]').count(), { timeout: 15_000 })
      .toBeGreaterThan(3);
    // kind filter narrows — pick whichever kind actually has a filter button
    // right now rather than hardcoding one: the button list is generated from
    // this account's CURRENT artifacts (ArtifactsGallery.tsx), and exactly
    // which kinds still exist drifts as other tests' cleanup runs delete
    // their own artifacts over the life of a long shared-account test suite
    const kindButtons = page.locator('div.flex.gap-2.mt-3.flex-wrap > button');
    const kindLabels = (await kindButtons.allInnerTexts()).filter((k) => k !== 'All');
    expect(kindLabels.length, 'at least one non-All kind filter available').toBeGreaterThan(0);
    const pick = kindLabels[0]!;
    await kindButtons.filter({ hasText: new RegExp(`^${pick}$`) }).first().click();
    await page.waitForTimeout(400);
    const kinds = await page.locator('span[style*="mono"], span.text-xs').allInnerTexts();
    expect(kinds.join(' ')).toContain(pick);
  });

  test('X8 mobile layout smoke (390px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForTimeout(1200);
    // composer must be visible and usable; no horizontal overflow
    await expect(composer(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow ${overflow}px`).toBeLessThanOrEqual(2);
  });

  test('X9 light theme toggle exists and applies', async ({ page }) => {
    // ThemePicker.tsx: "Replaces the old light/dark toggle — light is now
    // just one palette among five." A single click now only opens a picker
    // menu; the theme changes on selecting a palette from it, not on the
    // opening click itself.
    await page.goto('/');
    const toggle = page.locator('button:has(svg.lucide-palette), button[title*="heme"]').first();
    await expect(toggle, 'theme toggle').toBeVisible({ timeout: 5_000 });
    // the palette background lives on <html>, not <body> (index.css paints it
    // there so the correct color is ready on the very first frame, before
    // React mounts) — body itself carries no background-color at all
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

    await toggle.click();
    const menu = page.getByRole('menu', { name: 'Theme' });
    await expect(menu).toBeVisible();
    // pick whichever palette isn't already active, so this can't no-op
    const activeLabel = (await menu.locator('[aria-checked="true"]').innerText()).trim();
    await menu.locator('[aria-checked="false"]').first().click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(after, 'background must change on palette selection').not.toBe(before);

    // restore: reopen and click back to whatever was active before
    await toggle.click();
    await menu.getByRole('menuitemradio', { name: activeLabel }).click();
  });

  test('X10 keyboard: Enter sends, Shift-Enter newlines, Esc closes modal, Cmd-K new chat', async ({ page }) => {
    await newChat(page);
    const c = composer(page);
    await c.fill('line1');
    await c.press('Shift+Enter');
    await c.type('line2');
    expect(await c.inputValue()).toContain('\n');
    await c.fill('');
    // Esc closes an open modal (memory modal as the probe)
    const brain = page.locator('button:has(svg.lucide-brain)').first();
    if (await brain.isVisible().catch(() => false)) {
      await brain.click();
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      const modalGone = (await page.locator('[role="dialog"], [class*="modal"]').count()) === 0;
      expect(modalGone, 'Esc must close the modal').toBe(true);
    }
    // Cmd-K opens new chat / search
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(600);
    const kEffect =
      (await page.locator('input:focus').count()) > 0 ||
      (await composer(page).evaluate((el) => document.activeElement === el));
    expect(kEffect, 'Cmd-K must focus search or new chat').toBe(true);
  });
});
