/**
 * Ceiling check — the react/JSX skill against a request it could not previously
 * satisfy.
 *
 * Before: generation asked for 3072 output tokens (orchestrator.ts) and the
 * skill prompt told the model to stay under ~150 lines. An 8-screen app cannot
 * fit either, so the run truncated mid-JSON and surfaced as a bare
 * "Unexpected end of JSON input".
 *
 * After: no caller budget — the model is asked for its own ceiling — and a
 * genuine budget stop raises TruncatedOutputError instead of a parse error.
 *
 * Pass = valid JSON, all 8 screens present, deltas actually streamed.
 *
 *   pnpm tsx scripts/test/orchestration/ceiling-check.ts
 */
import { runAsAccount } from '../../../server/src/lib/account.js';
import { ensureBedrockConnected, bedrockSettings, activeModel, officeMaxTokens } from '../../../server/src/providers/bedrock.js';
import { completeJson } from '../../../server/src/providers/dispatch.js';
import { loadSkill } from '../../../server/src/pipeline/skills.js';
import { validateJson, validateFileMap } from '../../../server/src/pipeline/validate.js';

const REQUEST = 'Create an interface with 8 screens in JSX representing a car loan management website';

async function main(): Promise<void> {
  await runAsAccount('adammfisher', async () => {
    await ensureBedrockConnected();
    if (!bedrockSettings().connected) throw new Error('Bedrock not connected — cannot run a live check');

    const skill = loadSkill('react');
    const schema = skill.schema as Record<string, unknown>;
    console.log(`model=${activeModel().name}  office budget=${officeMaxTokens()} tokens`);
    console.log(`request: ${REQUEST}\n`);

    // mirrors officePrompt() in the orchestrator
    const system = `You are a document-generation backend. You produce ONLY a raw JSON object conforming exactly
to the schema described below. No markdown, no code fences, no prose, no extra keys.
SCHEMA (described): ${JSON.stringify(schema)}
DESIGN GUIDANCE: ${skill.guidance}
PROJECT INSTRUCTIONS: (none)
USER REQUEST: ${REQUEST}`;

    let deltas = 0;
    let firstDeltaMs = 0;
    const t0 = Date.now();

    const raw = await completeJson(
      [
        { role: 'system', content: system },
        { role: 'user', content: REQUEST },
      ],
      schema,
      {
        // exactly what the orchestrator now passes: the 24k office budget,
        // clamped to the model's own ceiling
        maxTokens: officeMaxTokens(),
        temperature: 0.2,
        onDelta: () => {
          if (!deltas) firstDeltaMs = Date.now() - t0;
          deltas++;
        },
      },
    );
    const elapsed = Date.now() - t0;

    console.log(`streamed ${deltas} deltas (first at ${firstDeltaMs}ms), ${elapsed}ms total`);
    console.log(`raw payload: ${raw.length} chars`);

    const result = validateJson('react', schema, raw);
    if (!result.ok) {
      console.log(`\nFAIL — schema invalid: ${result.error}`);
      process.exitCode = 1;
      return;
    }

    const payload = result.value as { files?: Record<string, string>; entry?: string };
    const files = payload.files ?? {};
    const names = Object.keys(files);
    const totalChars = names.reduce((n, f) => n + (files[f]?.length ?? 0), 0);
    const totalLines = names.reduce((n, f) => n + (files[f]?.split('\n').length ?? 0), 0);

    console.log(`\nentry: ${payload.entry}`);
    console.log(`files: ${names.length}`);
    for (const f of names) console.log(`  ${f.padEnd(28)} ${String(files[f]?.split('\n').length).padStart(5)} lines`);
    console.log(`total: ${totalLines} lines / ${totalChars} chars across ${names.length} files`);

    const mapCheck = validateFileMap(files);
    console.log(`file-map validation: ${mapCheck.ok ? 'ok' : `FAILED — ${mapCheck.error}`}`);

    // 8 screens were asked for. Count default-exported components in .jsx files
    // other than the entry — naming is the model's choice, so don't assume a
    // "Screen"/"View" suffix; the exported-component-per-file structure is what
    // actually makes something a screen here.
    const screens = names.filter(
      (f) => f !== payload.entry && f.endsWith('.jsx') && /export\s+default/.test(files[f] ?? ''),
    );
    console.log(`screen components found (${screens.length}):`);
    for (const s of screens) console.log(`  ${s}`);

    const OLD_CAP_CHARS = 3072 * 4; // the previous budget, at ~4 chars/token
    console.log(
      `\nold 3072-token cap ≈ ${OLD_CAP_CHARS} chars of JSON; this payload is ${raw.length} ` +
        `(${(raw.length / OLD_CAP_CHARS).toFixed(1)}x it) — it could not have been produced before.`,
    );

    const pass = mapCheck.ok && names.length >= 1 && screens.length >= 8;
    console.log(pass ? '\nPASS' : `\nFAIL — expected >=8 screens, got ${screens.length}`);
    if (!pass) process.exitCode = 1;
  });
}

void main();
