import { runAsAccount } from '../../../server/src/lib/account.js';
import { ensureBedrockConnected, bedrockSettings } from '../../../server/src/providers/bedrock.js';
import { classifyJson, structuredOutputs } from '../../../server/src/providers/dispatch.js';

const schema = {
  type: 'object', additionalProperties: false, required: ['workflowId', 'confidence'],
  properties: { workflowId: { type: 'string', enum: ['create-pptx', 'plain-conversation-qa'] }, confidence: { type: 'number' } },
};
async function main(): Promise<void> {
  await runAsAccount('adammfisher', async () => {
    await ensureBedrockConnected();
    console.log('bedrock connected:', bedrockSettings().connected, bedrockSettings().region);
    for (const key of ['nova', 'haiku', 'sonnet']) {
      const t0 = Date.now();
      try {
        const raw = await classifyJson(key,
          [{ role: 'system', content: 'Classify. Output the schema.' },
           { role: 'user', content: 'make me a deck about dogs' }], schema, { maxTokens: 64, temperature: 0 });
        console.log(`${key}: structuredOutputs=${structuredOutputs(key)} ${Date.now() - t0}ms -> ${raw.slice(0, 80)}`);
      } catch (e) {
        console.log(`${key}: ERROR ${Date.now() - t0}ms -> ${e instanceof Error ? e.message : e}`);
      }
    }
  });
}
void main();
