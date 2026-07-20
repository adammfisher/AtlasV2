import { test, expect } from '@playwright/test';
import { composer, sendNew, send, waitIdle, expectReply, cleanupMarked, assistantText, api, MARK } from './helpers';

test.describe('chat core @fast', () => {
  test.afterAll(cleanupMarked);

  test('streams a reply and recovers the composer', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Reply with exactly: E2E-STREAM-OK');
    await expectReply(page, /E2E-STREAM-OK/);
    await expect(composer(page)).toBeEnabled();
  });

  test('stop aborts, keeps the partial, and the next send works', async ({ page }) => {
    await page.goto('/');
    // "forty" items as words can finish generating in well under a flat
    // wait, especially under fast Bedrock latency — the stop button reverts
    // to send/arrow as soon as the stream ends, so a fixed-time guess before
    // clicking it races the model's own response speed. Wait for the stop
    // button to actually be visible instead (works regardless of response
    // speed). Tried bumping the count to 200 to make early completion
    // implausible instead — don't: a long, repetitive enumeration like that
    // reliably (5/5) trips Bedrock's content-filter guardrail as anomalous
    // output, a much worse failure mode than the original race.
    await sendNew(page, 'List the numbers one to forty as words, one per line, no other text.');
    const stop = page.locator('button:has(svg.lucide-square)').last();
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await stop.click();
    await page.waitForTimeout(2500);
    const t = await assistantText(page);
    expect(t).toMatch(/\bone\b/i); // partial persisted
    await send(page, 'Reply with exactly: AFTER-STOP-OK');
    await expectReply(page, /AFTER-STOP-OK/);
  });

  test('copy, regenerate and feedback controls render on assistant messages', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Say exactly: ERGONOMICS-OK');
    await expectReply(page, /ERGONOMICS-OK/);
    await expect(page.locator('button[title="Copy"]').last()).toBeVisible();
    await expect(page.locator('button[title="Regenerate response"]').last()).toBeVisible();
    // thumbs toggle persists
    await page.locator('button[title="Good response"]').last().click();
    await expect
      .poll(async () => page.locator('button[title="Good response"]').last().evaluate((el) => getComputedStyle(el).color))
      .not.toBe('rgb(133, 130, 122)'); // no longer mute
  });

  test('regenerate replaces the last response without duplicating the user turn', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Give me one random fruit name.');
    await waitIdle(page, 60_000);
    await page.locator('button[title="Regenerate response"]').last().click();
    await waitIdle(page, 60_000);
    // authoritative check: exactly one user turn, exactly one (fresh) response
    const convs = await api<Array<{ id: string; title: string }>>('/conversations');
    const conv = convs.find((c) => c.title.includes('random fruit'));
    expect(conv).toBeTruthy();
    const detail = await api<{ messages: Array<{ role: string }> }>(`/conversations/${conv!.id}`);
    expect(detail.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(detail.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
  });

  test('edit message truncates and regenerates', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Say exactly: BEFORE-EDIT');
    await expectReply(page, /BEFORE-EDIT/);
    await page.locator('.group\\/msg').last().hover();
    await page.locator('button[title*="Edit message"]').last().click({ force: true });
    await expect(page.getByText(/Editing message/)).toBeVisible();
    await composer(page).fill(`${MARK} Say exactly: AFTER-EDIT`);
    await composer(page).press('Enter');
    await expectReply(page, /AFTER-EDIT/);
    // scoped to the transcript's rendered messages, not the whole page: this
    // very conversation's OWN sidebar title is generated from its first
    // message ("[e2e] Say exactly: BEFORE-EDIT") and never renames itself
    // just because that message was later edited — assistantText(), a raw
    // page.locator('body').innerText(), correctly finds "BEFORE-EDIT" there
    // and always will. That's expected sidebar behavior, not what this test
    // is checking; only the transcript itself should have dropped it.
    const transcript = (await page.locator('.chat-md').allInnerTexts()).join('\n');
    expect(transcript).not.toContain('BEFORE-EDIT');
  });

  test('extended thinking streams a reasoning block', async ({ page }) => {
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.locator('button[title*="thinking"]').first().click();
    await send(page, 'Is 391 divisible by 17? Work it out.');
    await expect(page.getByText('Thinking', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await waitIdle(page, 90_000);
  });

  test('long replies are not silently capped at an arbitrary token ceiling (FX-23)', async ({ page }) => {
    // FX-23: every provider's chat-reply path defaulted to a flat 2048/4096
    // maxTokens instead of the model's real ceiling whenever the caller (this
    // app's chat.ts) didn't pass one explicitly — which it never did. A
    // max_tokens stop is indistinguishable from a normal one to the caller,
    // so a long reply just silently stopped mid-sentence with no error. This
    // prompt is deliberately built to require well over 2048 tokens of output,
    // so a regression of the old flat cap fails this test the same way a real
    // user hit it: a reply that stops mid-thought.
    //
    // Phrasing matters here beyond just length: a structured "explain X in N
    // labeled sections, at least Y words each" prompt gets classified by the
    // app's own router as a create_doc intent (see server/src/pipeline/
    // router.ts) and answered via the document-generation pipeline instead of
    // a plain chat reply — it renders as a downloadable artifact, not
    // '.chat-md', even when explicitly told not to create a file. Verified
    // live: that pipeline's own JSON-generation call already uses
    // modelMaxOutput() (bedrockCompleteJson), so it isn't itself an FX-23 risk,
    // but it also isn't what this test is trying to observe. Framing the ask
    // as one continuous conversational paragraph (no headers/sections) keeps
    // it on the plain streamWithTools/streamMessages path that originally hit
    // the bug, and reliably renders as '.chat-md'.
    //
    // Model choice matters too: whichever model this account currently has
    // selected is live, global server state (POST /api/models/select), not
    // scoped to a chat. Verified live that the fast/low-cost model doesn't
    // reliably honor "write at least N words" — it sometimes complies
    // (~14-20k chars) and sometimes answers in a couple hundred, which is
    // model compliance variance, not a token-ceiling bug, but it makes that
    // model useless as a deterministic regression lock. Haiku 4.5 follows
    // length instructions reliably while still being fast, so pin it for
    // just this test and restore whatever was selected before, even on
    // failure.
    test.setTimeout(90_000);
    const { selected: originalModel } = await api<{ selected: string }>('/models');
    await api('/models/select', { method: 'POST', body: JSON.stringify({ id: 'haiku' }) });
    try {
      await page.goto('/');
      await sendNew(
        page,
        "I'm trying to understand something, talk me through it conversationally in one long flowing paragraph — no headers, no bullet points, no numbered sections, nothing that looks like a document. Explain how a B-tree index works in a relational database: what problem it solves, how nodes are structured, what happens on insert including splits, what happens on delete including merges and redistribution, how range queries traverse it, and how it compares performance-wise to a hash index. Really go deep, at least 2500 words, as one continuous conversational reply, not a file.",
      );
      await waitIdle(page, 60_000);
      const transcript = await page.locator('.chat-md').last().innerText();
      // proves the reply wasn't cut off early — well past the old 2048-token
      // ceiling this test exists to catch a regression of (measured live: a
      // clean, unmodified run of this exact prompt produced ~14,800 characters)
      expect(transcript.length, 'reply should be substantial, not truncated early').toBeGreaterThan(10_000);
      // the actual FX-23 symptom: a max_tokens stop lands mid-clause, not at a
      // sentence boundary — permissive enough for markdown's own trailing
      // punctuation (bold/italic markers, code fences, closing parens/quotes)
      expect(transcript.trim(), 'reply must not end mid-sentence (silent token-ceiling truncation)').toMatch(
        /[.!?"'”’)*_`]\s*$/,
      );
    } finally {
      await api('/models/select', { method: 'POST', body: JSON.stringify({ id: originalModel }) });
    }
  });

  test('chat export downloads markdown', async ({ page }) => {
    await page.goto('/');
    await sendNew(page, 'Say exactly: EXPORT-ME');
    await expectReply(page, /EXPORT-ME/);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.locator('button[title="Export chat as Markdown"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });
});
