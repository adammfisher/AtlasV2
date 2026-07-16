/** officeGenerationModel must return Haiku for a Claude-restricted account
 * (brynn: nova/nemotron only) — office generation ignores the chat allowlist. */
import { runAsAccount } from '../../../server/src/lib/account.js';
import { setSetting } from '../../../server/src/db/db.js';
import { ensureBedrockConnected, activeModelDef, officeGenerationModel } from '../../../server/src/providers/bedrock.js';

for (const acct of ['brynn', 'demo', 'adammfisher']) {
  await runAsAccount(acct, async () => {
    await ensureBedrockConnected();
    setSetting('selectedModel', 'nemotron');
    const active = activeModelDef();
    const gen = officeGenerationModel();
    const ok = /claude/i.test(gen.model);
    console.log(`${acct.padEnd(12)} chat=${active.name.padEnd(22)} office→ ${gen.name.padEnd(18)} ${ok ? 'OK (Claude)' : 'FAIL'}`);
    if (!ok) process.exitCode = 1;
  });
}
// leave adammfisher's local selection on a Claude default
await runAsAccount('adammfisher', async () => setSetting('selectedModel', 'haiku'));
