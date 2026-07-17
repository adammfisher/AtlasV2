/**
 * DELIVERABLE B — drift test.
 *
 * A scripted 30-turn conversation on the SMALL tier (the fastest drifter):
 *   turns 1–5   establish formatting discipline (simple questions, prose answers)
 *   turns 6–30  bullet-bait ("give me some thoughts on X")
 *
 * History is windowed to the last 12 messages exactly as buildContext() does in
 * production — which is precisely why drift happens: the early prose-shaped
 * exchanges fall out of context. The reminder is what has to hold the line.
 *
 * Two assertions:
 *   1. after the first reminder fires, bullet-bait answers stay prose-first;
 *   2. the system prefix handed to Converse is byte-identical on every turn —
 *      the reminder rides the USER message, so the cached prefix never moves.
 */
import { setSetting } from '../../../server/src/db/appdb.js';
import { __setConverseObserver } from '../../../server/src/providers/bedrock.js';
import { completeTextAs } from '../../../server/src/providers/dispatch.js';
import { buildBehaviorBlock, startAtUserTurn } from '../../../server/src/pipeline/context.js';
import { applyReminder, recordUsage, reminderTurnsFor } from '../../../server/src/pipeline/reminder.js';
import { MODEL_FOR_TIER, hasBullets, withBedrock, confirmed, type CaseResult } from './lib.js';
import type { ChatMessage } from '../../../server/src/llama/client.js';

const TIER = 'small' as const;
const TURNS = 30;
const WINDOW = 12; // mirrors RECENT_COUNT in context.ts

/**
 * Turns 1–5 are LEGITIMATE list requests. The doctrine permits lists here, so the
 * model answers with them and the window fills with its own bulleted output.
 *
 * That is the actual drift mechanism, and the first version of this test missed
 * it: bland "give me some thoughts on X" bait produced no drift at all (the
 * control passed 24/24), because the behavior block sits in the system prompt on
 * every turn and easily wins. What defeats it is self-reinforcement — the model
 * imitating the bulleted pattern it can still see itself using.
 */
const WARMUP = [
  'list the steps to deploy a Node app to AWS Lambda',
  'give me a numbered checklist for onboarding a new engineer',
  'what are the HTTP status code categories and what does each one mean?',
  'outline a 5-step incident response runbook',
  'list the tradeoffs between REST and GraphQL',
];

/** Simple/casual prompts the doctrine requires be answered in PROSE, asked while
 * the window is still full of the assistant's own bulleted answers. */
const BAIT_TOPICS = [
  "what's a semaphore?", 'is Python compiled or interpreted?', 'who wrote Dune?',
  "what's the capital of France?", 'what does TTL stand for?', "what's 15% of 240?",
  'is London on UTC during the summer?', "what's the difference between HTTP and HTTPS?",
  'what does REST stand for?', 'is Redis single-threaded?',
  'what year did Python 3 come out?', "what's a mutex?",
  'does JavaScript have integers?', "what's the default port for Postgres?",
  'is HTTP/2 binary or text?', "what's a race condition?",
  'what does CORS stand for?', 'is Git distributed or centralized?',
  "what's a foreign key?", 'what does SLA stand for?',
  "what's idempotency?", 'is JSON a subset of YAML?',
  "what's a load balancer?", 'what does DNS do?', "what's a webhook?",
];

const PERSONA =
  'You are Axiom, an AI assistant running on Amazon Bedrock. You help with conversation, analysis, ' +
  'and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and ' +
  'small app prototypes. Be direct, concise, and concrete.';

/**
 * POLISH_DRIFT_CONTROL=1 runs the identical conversation with reminders
 * DISABLED. It is not gated — it exists to prove the gated run has teeth. If the
 * control drifts to bullets and the reminded run does not, the reminder is doing
 * the work; if neither drifts, this test proves nothing and should be rebuilt.
 */
const CONTROL = process.env.POLISH_DRIFT_CONTROL === '1';

export async function runDrift(): Promise<{ passed: number; failed: number; results: CaseResult[] }> {
  const convId = `c_polish_drift_${Date.now()}`;
  setSetting(`remind:${convId}`, ''); // fresh state
  const system = [PERSONA, buildBehaviorBlock(TIER)].join('\n\n');
  const threshold = reminderTurnsFor(TIER);

  const prefixes: string[] = [];
  __setConverseObserver((p) => prefixes.push(JSON.stringify(p.system)));

  const history: ChatMessage[] = [];
  const results: CaseResult[] = [];
  const firedAt: number[] = [];
  let firstReminderTurn: number | null = null;
  let flakes = 0;

  for (let turn = 1; turn <= TURNS; turn++) {
    const isWarmup = turn <= WARMUP.length;
    const prompt = isWarmup ? WARMUP[turn - 1]! : BAIT_TOPICS[(turn - WARMUP.length - 1) % BAIT_TOPICS.length]!;

    history.push({ role: 'user', content: prompt });
    // same window buildContext() applies, through the same leading-assistant
    // guard — a raw last-12 slice starts on an assistant turn and Converse 400s
    const windowed = startAtUserTurn(history.slice(-WINDOW) as Array<{ role: 'user' | 'assistant'; content: ChatMessage['content'] }>) as ChatMessage[];
    const { messages, fired } = CONTROL
      ? { messages: windowed, fired: false }
      : applyReminder(windowed, convId, turn, TIER);
    if (fired) {
      firedAt.push(turn);
      firstReminderTurn ??= turn;
      // it must ride the OUTGOING user turn and nothing else
      const onUserTurn = String(messages[messages.map((m) => m.role).lastIndexOf('user')]?.content ?? '').includes(
        '<behavior_reminder>',
      );
      results.push({
        name: `turn ${turn}: reminder rides the outgoing user message`,
        tier: TIER,
        pass: onUserTurn,
        detail: onUserTurn ? '' : 'reminder missing from the outgoing user turn',
      });
    }
    // the control has no reminder, so gate from the turn one WOULD have fired
    if (CONTROL && turn % reminderTurnsFor(TIER) === 0) firstReminderTurn ??= turn;

    const text = (
      await completeTextAs(
        MODEL_FOR_TIER[TIER],
        [{ role: 'system', content: system }, ...messages],
        { maxTokens: 500, temperature: 0 },
      )
    ).trim();
    history.push({ role: 'assistant', content: text });

    // approximate the context size the way production does — from real usage.
    // completeTextAs has no usage callback, so approximate from characters
    // (4 chars/token) purely to exercise the token trigger's bookkeeping.
    recordUsage(convId, Math.round((system.length + windowed.reduce((n, m) => n + String(m.content).length, 0)) / 4));

    // gate only the bait turns at or after the first reminder
    if (!isWarmup && firstReminderTurn !== null && turn >= firstReminderTurn) {
      const judge = (t: string): CaseResult => ({
        name: `turn ${turn}: ${prompt.slice(0, 40)}`,
        tier: TIER,
        pass: !hasBullets(t),
        detail: hasBullets(t) ? `drifted to bullets — "${t.replace(/\s+/g, ' ').slice(0, 100)}"` : '',
      });
      // one sample of a stochastic model is not evidence of drift — re-ask the
      // same turn with the same context before calling it a failure
      const r = await confirmed(judge(text), async () =>
        judge(
          (
            await completeTextAs(MODEL_FOR_TIER[TIER], [{ role: 'system', content: system }, ...messages], {
              maxTokens: 500,
              temperature: 0,
            })
          ).trim(),
        ),
      );
      if ((r as { flaked?: boolean }).flaked) flakes++;
      results.push(r);
    }
  }
  __setConverseObserver(null);

  // 1. reminder cadence (skipped in the control, which fires none by design)
  if (!CONTROL) {
    const expected = Array.from({ length: Math.floor(TURNS / threshold) }, (_, i) => (i + 1) * threshold);
    const cadenceOk = JSON.stringify(firedAt) === JSON.stringify(expected);
    results.push({
      name: `reminder cadence every ${threshold} turns`,
      tier: TIER,
      pass: cadenceOk,
      detail: cadenceOk ? '' : `fired at [${firedAt}], expected [${expected}]`,
    });
  }

  // 2. invisibility: the stored transcript never carries the reminder, so it can
  // never be echoed back to the user or persisted as a visible message
  const leaked = history.some((m) => String(m.content).includes('<behavior_reminder>'));
  results.push({
    name: 'reminder never enters the stored transcript',
    tier: TIER,
    pass: !leaked,
    detail: leaked ? 'reminder text leaked into stored history' : '',
  });

  // 3. system prefix byte-stability across all turns
  const unique = new Set(prefixes);
  results.push({
    name: 'system prefix byte-identical across all turns',
    tier: TIER,
    pass: unique.size === 1,
    detail: unique.size === 1 ? '' : `${unique.size} distinct system prefixes across ${prefixes.length} turns`,
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n── B: drift (${TURNS} turns, ${TIER} tier, reminder every ${threshold})`);
  for (const r of failed) console.log(`  FAIL ${r.name}: ${r.detail}`);
  console.log(`  reminders fired at turns: [${firedAt.join(', ')}]`);
  if (flakes) console.log(`  (first-pass failures that did NOT reproduce: ${flakes})`);
  console.log(`B/drift: ${results.length - failed.length}/${results.length} passed`);
  return { passed: results.length - failed.length, failed: failed.length, results };
}

if (process.argv[1]?.endsWith('drift.ts')) {
  const r = await withBedrock(runDrift);
  process.exit(r.failed === 0 ? 0 : 1);
}
