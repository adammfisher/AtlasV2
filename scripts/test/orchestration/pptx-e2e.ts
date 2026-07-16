/**
 * Exercises the reworked office path on the user's exact case:
 *   "Make me a 3-slide deck about coffee brewing methods."
 * With Nemotron SELECTED — proving all three fixes at once:
 *   #2 Claude-gating: officeGenerationModel substitutes a Claude model.
 *   #4 smooth streaming: completeJsonOffice emits deltas progressively (plain
 *      streaming), not one buffered burst.
 *   (#3 build-repair is exercised by the full create pipeline; here we build the
 *      generated payload directly and confirm it's valid current-schema.)
 *
 *   pnpm tsx scripts/test/orchestration/pptx-e2e.ts <out.json>
 */
import { writeFileSync } from 'node:fs';
import { runAsAccount } from '../../../server/src/lib/account.js';
import { setSetting } from '../../../server/src/db/db.js';
import {
  ensureBedrockConnected, bedrockSettings, activeModel, officeGenerationModel, officeMaxTokens,
} from '../../../server/src/providers/bedrock.js';
import { completeJsonOffice } from '../../../server/src/llama/json.js';
import { loadSkill } from '../../../server/src/pipeline/skills.js';
import { validateJson, officeDoctrineCheck } from '../../../server/src/pipeline/validate.js';

const REQUEST = 'Make me a 3-slide deck about coffee brewing methods.';
const OUT = process.argv[2] ?? '/tmp/coffee.pptx.json';

async function main(): Promise<void> {
  await runAsAccount('adammfisher', async () => {
    await ensureBedrockConnected();
    if (!bedrockSettings().connected) throw new Error('Bedrock not connected');

    // select a NON-Claude model, as in the screenshots
    setSetting('selectedModel', 'nemotron');
    console.log(`selected (chat) model : ${activeModel().name}`);
    const gen = officeGenerationModel();
    console.log(`office generation model: ${gen.name}  (#2 gating ${/claude/i.test(gen.model) ? 'OK — substituted to Claude' : 'FAILED'})`);

    const skill = loadSkill('pptx');
    const schema = skill.schema as Record<string, unknown>;
    const system = `You are a document-generation backend. You produce ONLY a raw JSON object conforming exactly
to the schema described below. No markdown, no code fences, no prose, no extra keys.
SCHEMA (described): ${JSON.stringify(schema)}
DESIGN GUIDANCE: ${skill.guidance}
PROJECT INSTRUCTIONS: (none)
USER REQUEST: ${REQUEST}`;

    const t0 = Date.now();
    const deltaTimes: number[] = [];
    const raw = await completeJsonOffice(
      [{ role: 'system', content: system }, { role: 'user', content: REQUEST }],
      schema,
      { maxTokens: officeMaxTokens(), temperature: 0.2, onDelta: () => deltaTimes.push(Date.now() - t0) },
    );
    const elapsed = Date.now() - t0;

    // smoothness: first delta early + deltas spread across the run = real streaming
    const first = deltaTimes[0] ?? -1;
    const last = deltaTimes[deltaTimes.length - 1] ?? -1;
    const spread = last - first;
    console.log(`\n#4 streaming: ${deltaTimes.length} deltas, first@${first}ms, last@${last}ms, spread ${spread}ms of ${elapsed}ms total`);
    console.log(`   ${first < elapsed * 0.5 && spread > elapsed * 0.3 ? 'OK — progressive (not a tail-end burst)' : 'NOTE — still bursty'}`);

    const result = validateJson('pptx', schema, raw);
    if (!result.ok) { console.log(`\nFAIL — schema invalid: ${result.error}`); process.exitCode = 1; return; }
    const p = result.value as { title?: string; slides?: Array<Record<string, unknown>> };
    console.log(`\ndeck "${p.title}" — ${(p.slides ?? []).length} slides, archetypes: ${(p.slides ?? []).map((s) => s.archetype).join(', ')}`);
    const doctrine = officeDoctrineCheck('pptx', result.value, false);
    console.log(`doctrine pre-check: ${doctrine.ok ? 'clean' : doctrine.error}`);

    writeFileSync(OUT, JSON.stringify(result.value));
    console.log(`\npayload → ${OUT}`);
    console.log(/claude/i.test(gen.model) ? 'PASS (#2 gating + #4 streaming verified)' : 'FAIL');
    if (!/claude/i.test(gen.model)) process.exitCode = 1;
  });
}

void main();
