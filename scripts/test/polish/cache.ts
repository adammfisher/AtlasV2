/**
 * DELIVERABLE E — cache gates.
 *
 *  1. PREFIX BYTE-STABILITY: the stable prefix (sections 1–5) handed to Converse
 *     must be byte-identical across consecutive turns. Asserted on the REAL
 *     payload via the toConverse observer, not on a re-derivation of it — one
 *     stray timestamp costs every cache hit in the product, and only the real
 *     payload proves it isn't there.
 *  2. CACHE READS: a 10-turn conversation on a caching-capable model must show
 *     cacheReadInputTokens > 0 from turn 2 onward.
 *
 * Everything runs through the production path (completeTextAs -> toConverse ->
 * Converse), so the CACHE_POINT sentinel is converted exactly as it is in chat.
 */
import {
  __setConverseObserver,
  CACHE_POINT,
  modelDefByKey,
  promptCacheEnabled,
  type ConverseUsage,
} from '../../../server/src/providers/bedrock.js';
import { completeTextAs } from '../../../server/src/providers/dispatch.js';
import { assembleSystemPrompt, buildBehaviorBlock, skillsMetadata, tierForModel } from '../../../server/src/pipeline/context.js';
import { report, type CaseResult } from './lib.js';
import type { ChatMessage } from '../../../server/src/llama/client.js';

const PERSONA =
  'You are Atlas, an AI assistant running on Amazon Bedrock. You help with conversation, analysis, ' +
  'and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and ' +
  'small app prototypes. Be direct, concise, and concrete.';

/** Production-shaped assembly. Per-turn material differs every turn on purpose:
 * the gate is that it never disturbs the prefix. */
function assembleForTurn(turn: number, modelKey: string): { stablePrefix: string; perTurn: string } {
  return assembleSystemPrompt({
    persona: PERSONA,
    behavior: buildBehaviorBlock(tierForModel(modelKey), { citations: true }),
    skills: skillsMetadata(),
    toolNotes: ['MEMORY: call the remember or forget tool before replying when asked to remember something.'],
    preferences: '',
    projectInstructions: 'Ship carefully. Prefer prose.',
    // per-turn: grows and changes every single turn
    conversationSummary: `The user has asked ${turn} questions so far, most recently about topic #${turn}.`,
    memoryRecall: `Known context (memory):\nAbout the user:\nuser_fact.turn_${turn}: recall sample ${turn}.`,
  });
}

export async function runCache(): Promise<{ passed: number; failed: number; results: CaseResult[]; summary: string }> {
  const results: CaseResult[] = [];
  const unit = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, tier: 'frontier', pass, detail });
  };
  const MODEL = 'sonnet'; // caching-capable, and its 1024 minimum is under Atlas's ~1.5k prefix (haiku's 4096 is not)

  // ── gate 1: prefix byte-stability, observed on the real Converse payload
  const prefixes: string[] = [];
  const sawCachePoint: boolean[] = [];
  __setConverseObserver((p) => {
    // the prefix is everything up to the cache point — exactly what Bedrock caches
    const cut = p.system.findIndex((b) => 'cachePoint' in b);
    sawCachePoint.push(cut !== -1);
    prefixes.push(JSON.stringify(cut === -1 ? p.system : p.system.slice(0, cut)));
  });

  for (const turn of [1, 2]) {
    const a = assembleForTurn(turn, MODEL);
    await completeTextAs(
      MODEL,
      [
        { role: 'system', content: a.stablePrefix },
        { role: 'system', content: CACHE_POINT },
        { role: 'system', content: a.perTurn },
        { role: 'user', content: 'Reply with the single word ok.' },
      ] as ChatMessage[],
      { maxTokens: 8, temperature: 0 },
    );
  }
  __setConverseObserver(null);

  unit('sentinel becomes a real cachePoint block', sawCachePoint.every(Boolean), 'no cachePoint block in the payload');
  unit('sentinel never leaks into the prompt as text', !prefixes.some((p) => p.includes('atlas:cachePoint')), 'the sentinel was sent as prompt text');
  const distinct = new Set(prefixes);
  unit('prefix is byte-identical across consecutive turns', distinct.size === 1, `${distinct.size} distinct prefixes across ${prefixes.length} turns`);

  // hunt the classic cache-killers directly
  const p1 = assembleForTurn(1, MODEL).stablePrefix;
  const p2 = assembleForTurn(2, MODEL).stablePrefix;
  unit('assembled prefix stable across turns', p1 === p2, 'stablePrefix differs between turns');
  unit('prefix carries no ISO timestamp', !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p1), 'timestamp found in the cached prefix');
  unit('prefix carries no epoch-looking number', !/\b1[6-9]\d{11}\b/.test(p1), 'epoch ms found in the cached prefix');
  unit('per-turn material is NOT in the prefix', !p1.includes('recall sample'), 'per-turn recall leaked into the cached prefix');
  unit('per-turn material really does vary (this test can fail)', assembleForTurn(1, MODEL).perTurn !== assembleForTurn(2, MODEL).perTurn);

  // ── capability flags match what was measured live
  unit('haiku: prompt cache enabled', promptCacheEnabled(modelDefByKey('haiku')!));
  unit('sonnet: prompt cache enabled', promptCacheEnabled(modelDefByKey('sonnet')!));
  unit('nova: prompt cache DISABLED (bills writes, never reads)', !promptCacheEnabled(modelDefByKey('nova')!));
  unit('nemotron: prompt cache DISABLED (a cachePoint fails the request)', !promptCacheEnabled(modelDefByKey('nemotron')!));

  // ── gate 2: a 10-turn conversation must show cache reads from turn 2 onward
  const lines: string[] = [];
  let readsFromTurn2 = true;
  let writeTurn1 = 0;
  let readTurns = 0;
  const history: ChatMessage[] = [];
  // a salt keeps this run from reading the previous run's cache entry, so the
  // turn-1 write is always real
  const salt = `run-${process.pid}`;

  for (let turn = 1; turn <= 10; turn++) {
    const a = assembleForTurn(turn, MODEL);
    history.push({ role: 'user', content: `Question ${turn}: what is ${turn} + ${turn}? Answer with the number only.` });
    let usage: ConverseUsage | undefined;
    const answer = await completeTextAs(
      MODEL,
      [
        { role: 'system', content: `${a.stablePrefix}\n<session>${salt}</session>` },
        { role: 'system', content: CACHE_POINT },
        { role: 'system', content: a.perTurn },
        ...history,
      ] as ChatMessage[],
      { maxTokens: 24, temperature: 0, onUsage: (u) => (usage = u) },
    );
    history.push({ role: 'assistant', content: answer || 'ok' });
    const read = usage?.cacheReadInputTokens ?? 0;
    const write = usage?.cacheWriteInputTokens ?? 0;
    lines.push(
      `turn ${String(turn).padStart(2)}: in=${String(usage?.inputTokens ?? 0).padStart(5)} cacheRead=${String(read).padStart(5)} cacheWrite=${String(write).padStart(5)}`,
    );
    if (turn === 1) writeTurn1 = write;
    if (read > 0) readTurns++;
    if (turn >= 2 && read === 0) readsFromTurn2 = false;
  }
  for (const l of lines) console.log(`  ${l}`);
  unit(`10-turn ${MODEL} conversation shows cache reads from turn 2 onward`, readsFromTurn2, 'a turn >= 2 reported cacheRead=0');

  const summary =
    `${MODEL}: ${writeTurn1}-token cache write on turn 1, cache reads on ${readTurns}/10 turns ` +
    `(hit ratio ${(readTurns / 10).toFixed(2)}; 9/10 is the ceiling — turn 1 can only write).`;

  console.log(`\n── E: cache (${results.length} checks)`);
  const s = report('E/cache', results);
  console.log(`  ${summary}`);
  return { ...s, results, summary };
}

if (process.argv[1]?.endsWith('cache.ts')) {
  const { withBedrock } = await import('./lib.js');
  const r = await withBedrock(runCache);
  process.exit(r.failed === 0 ? 0 : 1);
}
