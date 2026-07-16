/** Confirms the react map-schema still generates cleanly through the new
 * plain-streaming office path (react was previously routed via forced tool-use).
 *   pnpm tsx scripts/test/orchestration/react-plain-check.ts */
import { runAsAccount } from '../../../server/src/lib/account.js';
import { setSetting } from '../../../server/src/db/db.js';
import { ensureBedrockConnected, activeModel } from '../../../server/src/providers/bedrock.js';
import { completeJsonOffice } from '../../../server/src/llama/json.js';
import { loadSkill } from '../../../server/src/pipeline/skills.js';
import { validateJson, validateFileMap } from '../../../server/src/pipeline/validate.js';

await runAsAccount('adammfisher', async () => {
  await ensureBedrockConnected();
  setSetting('selectedModel', 'haiku'); // reset from the nemotron test
  const skill = loadSkill('react');
  const schema = skill.schema as Record<string, unknown>;
  const sys = `You are a document-generation backend. Produce ONLY a raw JSON object matching this schema, no markdown/fences. SCHEMA: ${JSON.stringify(schema)}\nDESIGN: ${skill.guidance}`;
  const req = 'A simple counter component with increment and reset buttons';
  const t0 = Date.now();
  const dt: number[] = [];
  const raw = await completeJsonOffice(
    [{ role: 'system', content: sys }, { role: 'user', content: req }],
    schema,
    { temperature: 0.2, onDelta: () => dt.push(Date.now() - t0) },
  );
  const r = validateJson('react', schema, raw);
  console.log(`react via plain-stream office path: model=${activeModel().name}`);
  console.log(`  deltas=${dt.length} first@${dt[0] ?? -1}ms last@${dt[dt.length - 1] ?? -1}ms  valid=${r.ok}`);
  if (r.ok) {
    const files = (r.value as { files: Record<string, string> }).files;
    const fm = validateFileMap(files);
    console.log(`  files=${Object.keys(files).join(', ')}  fileMap=${fm.ok ? 'ok' : fm.error}`);
    console.log(fm.ok ? 'REACT OK' : 'REACT FAIL');
    if (!fm.ok) process.exitCode = 1;
  } else {
    console.log(`  invalid: ${r.error}`);
    process.exitCode = 1;
  }
});
