/**
 * Phase 4 — memory suite (TESTPLAN §Phase 4). Live Bedrock, structural/content
 * assertions. Each test uses its own fresh project so memory facts can't leak
 * between tests. The forbidden-phrase scanner (findNarration) runs over every
 * live response captured here — the etiquette rule is "never narrate
 * retrieval," and this enforces it mechanically rather than trusting the
 * prompt, per the polish command's own design (memory/narration.ts).
 */
import { test, expect } from '@playwright/test';
import { createConv, createProject, deleteProject, cleanupE2E, MARK } from '../../helpers/axiom-api.js';
import { sendAndWait } from '../../helpers/artifacts.js';
import { findNarration } from '../../../server/src/memory/narration.js';

test.afterEach(async () => {
  await cleanupE2E().catch(() => undefined);
});

function assertNoNarration(text: string, label: string): void {
  const hits = findNarration(text);
  expect(hits, `${label}: forbidden memory-narration phrasing found: ${JSON.stringify(hits)}`).toHaveLength(0);
}

test('M-1 remember tool fires and the fact is stored', async () => {
  test.setTimeout(120_000);
  const project = await createProject('[e2e] memory-M1');
  try {
    const conv = await createConv(project.id);
    const res = await sendAndWait(conv.id, `${MARK} Remember for this project: the release cadence is every second Tuesday.`, {
      timeoutMs: 90_000,
    });
    expect(res.error, `errored: ${res.error}`).toBeUndefined();
    expect(res.tools, `remember tool did not fire: ${JSON.stringify(res.tools)}`).toContain('remember');
    assertNoNarration(res.text, 'M-1 confirmation');
  } finally {
    await deleteProject(project.id).catch(() => undefined);
  }
});

test('M-2 recall injection: a fact stored in one conversation is applied naturally in a NEW conversation', async () => {
  test.setTimeout(150_000);
  const project = await createProject('[e2e] memory-M2');
  try {
    const conv1 = await createConv(project.id);
    const store = await sendAndWait(conv1.id, `${MARK} Remember for this project: our deploy target is AWS Fargate in us-east-2.`, {
      timeoutMs: 90_000,
    });
    expect(store.tools).toContain('remember');

    const conv2 = await createConv(project.id);
    const recall = await sendAndWait(conv2.id, `${MARK} Where do our deploys run?`, { timeoutMs: 90_000 });
    expect(recall.error, `errored: ${recall.error}`).toBeUndefined();
    expect(recall.text.toLowerCase(), `fact not naturally recalled: ${recall.text.slice(0, 300)}`).toContain('fargate');
    assertNoNarration(recall.text, 'M-2 recall');
  } finally {
    await deleteProject(project.id).catch(() => undefined);
  }
});

test('M-3 forget tool fires and the fact stops being recalled', async () => {
  test.setTimeout(180_000);
  const project = await createProject('[e2e] memory-M3');
  try {
    const conv1 = await createConv(project.id);
    const store = await sendAndWait(conv1.id, `${MARK} Remember for this project: the on-call rotation lead is named Priya.`, {
      timeoutMs: 90_000,
    });
    expect(store.tools).toContain('remember');

    const conv2 = await createConv(project.id);
    const forget = await sendAndWait(conv2.id, `${MARK} Forget everything about the on-call rotation lead for this project.`, {
      timeoutMs: 90_000,
    });
    expect(forget.tools, `forget tool did not fire: ${JSON.stringify(forget.tools)}`).toContain('forget');

    const conv3 = await createConv(project.id);
    const recall = await sendAndWait(conv3.id, `${MARK} Who is the on-call rotation lead?`, { timeoutMs: 90_000 });
    expect(recall.text.toLowerCase(), `forgotten fact still recalled: ${recall.text.slice(0, 300)}`).not.toContain('priya');
  } finally {
    await deleteProject(project.id).catch(() => undefined);
  }
});

test('M-4 etiquette: a simple greeting does not dump stored facts', async () => {
  test.setTimeout(120_000);
  const project = await createProject('[e2e] memory-M4');
  try {
    const conv1 = await createConv(project.id);
    const store = await sendAndWait(
      conv1.id,
      `${MARK} Remember for this project: the primary customer is Meridian Logistics, contract value 2.4M.`,
      { timeoutMs: 90_000 },
    );
    expect(store.tools).toContain('remember');

    const conv2 = await createConv(project.id);
    const greeting = await sendAndWait(conv2.id, `${MARK} Hey, good morning!`, { timeoutMs: 90_000 });
    expect(greeting.error, `errored: ${greeting.error}`).toBeUndefined();
    const lower = greeting.text.toLowerCase();
    expect(lower, `greeting leaked unrelated stored facts: ${greeting.text.slice(0, 300)}`).not.toContain('meridian');
    expect(lower).not.toContain('2.4m');
    assertNoNarration(greeting.text, 'M-4 greeting');
  } finally {
    await deleteProject(project.id).catch(() => undefined);
  }
});

test('M-5 etiquette: a generic technical question applies zero stored memories', async () => {
  test.setTimeout(120_000);
  const project = await createProject('[e2e] memory-M5');
  try {
    const conv1 = await createConv(project.id);
    const store = await sendAndWait(conv1.id, `${MARK} Remember for this project: our brand accent color is #7C5CFF.`, {
      timeoutMs: 90_000,
    });
    expect(store.tools).toContain('remember');

    const conv2 = await createConv(project.id);
    const generic = await sendAndWait(conv2.id, `${MARK} What is the time complexity of binary search?`, { timeoutMs: 90_000 });
    expect(generic.error, `errored: ${generic.error}`).toBeUndefined();
    expect(generic.text.toLowerCase(), `unrelated technical answer leaked a stored fact: ${generic.text.slice(0, 300)}`).not.toContain(
      '#7c5cff',
    );
    assertNoNarration(generic.text, 'M-5 generic question');
  } finally {
    await deleteProject(project.id).catch(() => undefined);
  }
});

test('M-6 project scoping: a fact stored in project A is not recalled in project B', async () => {
  test.setTimeout(150_000);
  const a = await createProject('[e2e] memory-M6-a');
  const b = await createProject('[e2e] memory-M6-b');
  try {
    const convA = await createConv(a.id);
    const store = await sendAndWait(convA.id, `${MARK} Remember for this project: the codeword is FALCONWATCH-19.`, {
      timeoutMs: 90_000,
    });
    expect(store.tools).toContain('remember');

    const convB = await createConv(b.id);
    const recall = await sendAndWait(convB.id, `${MARK} What is the codeword?`, { timeoutMs: 90_000 });
    expect(recall.text.toLowerCase(), `project A fact leaked into project B: ${recall.text.slice(0, 300)}`).not.toContain(
      'falconwatch-19',
    );
  } finally {
    await deleteProject(a.id).catch(() => undefined);
    await deleteProject(b.id).catch(() => undefined);
  }
});

test('M-7 project scoping: a fact stored in project B is not recalled in project A (bidirectional)', async () => {
  test.setTimeout(150_000);
  const a = await createProject('[e2e] memory-M7-a');
  const b = await createProject('[e2e] memory-M7-b');
  try {
    const convB = await createConv(b.id);
    const store = await sendAndWait(convB.id, `${MARK} Remember for this project: the codeword is IRONVALE-42.`, {
      timeoutMs: 90_000,
    });
    expect(store.tools).toContain('remember');

    const convA = await createConv(a.id);
    const recall = await sendAndWait(convA.id, `${MARK} What is the codeword?`, { timeoutMs: 90_000 });
    expect(recall.text.toLowerCase(), `project B fact leaked into project A: ${recall.text.slice(0, 300)}`).not.toContain(
      'ironvale-42',
    );
  } finally {
    await deleteProject(a.id).catch(() => undefined);
    await deleteProject(b.id).catch(() => undefined);
  }
});

test('M-8 direct factual self-question about a stored fact is answered flatly, no narration preamble', async () => {
  test.setTimeout(120_000);
  const project = await createProject('[e2e] memory-M8');
  try {
    const conv1 = await createConv(project.id);
    const store = await sendAndWait(conv1.id, `${MARK} Remember for this project: our support SLA is 4 business hours.`, {
      timeoutMs: 90_000,
    });
    expect(store.tools).toContain('remember');

    const conv2 = await createConv(project.id);
    const ask = await sendAndWait(conv2.id, `${MARK} What's our support SLA?`, { timeoutMs: 90_000 });
    expect(ask.text.toLowerCase(), `fact not recalled: ${ask.text.slice(0, 300)}`).toContain('4 business hours');
    assertNoNarration(ask.text, 'M-8 direct question');
  } finally {
    await deleteProject(project.id).catch(() => undefined);
  }
});
