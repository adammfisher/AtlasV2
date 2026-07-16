/**
 * Truncation-honesty check.
 *
 * Forces a budget far too small for the request. Before, the react path
 * (forced tool-use, because its schema has map props) accumulated a cut-off
 * fragment string and threw a bare `SyntaxError: Unexpected end of JSON input`
 * from JSON.parse — which matched none of the fallback predicates, escaped the
 * orchestrator's repair loop entirely (it wraps no try/catch around
 * completeJson), and reached the user as a parse failure. Nothing anywhere read
 * stopReason, so a budget stop was indistinguishable from a broken model.
 *
 * Pass = TruncatedOutputError naming the ceiling, NOT a JSON parse error.
 *
 *   pnpm tsx scripts/test/orchestration/truncation-check.ts
 */
import { runAsAccount } from '../../../server/src/lib/account.js';
import { ensureBedrockConnected, bedrockSettings, TruncatedOutputError } from '../../../server/src/providers/bedrock.js';
import { completeJson } from '../../../server/src/providers/dispatch.js';
import { loadSkill } from '../../../server/src/pipeline/skills.js';

const REQUEST = 'Create an interface with 8 screens in JSX representing a car loan management website';

async function main(): Promise<void> {
  await runAsAccount('adammfisher', async () => {
    await ensureBedrockConnected();
    if (!bedrockSettings().connected) throw new Error('Bedrock not connected — cannot run a live check');

    const skill = loadSkill('react');
    const schema = skill.schema as Record<string, unknown>;

    console.log('asking for the 8-screen app with a deliberately tiny 400-token budget...\n');
    try {
      await completeJson(
        [
          { role: 'system', content: `Emit JSON matching: ${JSON.stringify(schema)}` },
          { role: 'user', content: REQUEST },
        ],
        schema,
        { maxTokens: 400, temperature: 0.2 },
      );
      console.log('FAIL — expected a truncation error, got a clean result');
      process.exitCode = 1;
    } catch (err) {
      if (err instanceof TruncatedOutputError) {
        console.log(`PASS — surfaced as TruncatedOutputError:\n  "${err.message}"`);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAIL — got ${err instanceof Error ? err.constructor.name : typeof err}: ${msg}`);
      process.exitCode = 1;
    }
  });
}

void main();
