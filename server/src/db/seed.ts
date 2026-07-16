/**
 * First-boot seed (DynamoDB era): three starter projects + bundled plugin
 * installs + defaults, only when the table has never been seeded. Real data
 * from the SQLite era arrives via scripts/migrate-sqlite-to-dynamo.ts.
 */
import { getSetting, setSetting } from './appdb.js';
import { putProject, putInstall, now } from './appdb.js';
import { log } from '../log.js';

export async function seedIfNeeded(): Promise<void> {
  if (getSetting('seeded') === '3') return;
  const t = now();
  await putProject({
    id: 'p1',
    name: 'Lightspeed Atlas',
    instructions: 'Enterprise rollout workspace. Prefer Lightspeed deck template; cite Jira keys.',
    settings: '{}',
    created_at: t,
  });
  await putProject({
    id: 'p2',
    name: 'Client Alpha — QBR',
    instructions: 'Confidential. Hard isolation; never reference other client work.',
    settings: '{}',
    created_at: t,
  });
  await putProject({
    id: 'p3',
    name: 'Internal Ops',
    instructions: 'Ops runbooks and weekly reporting.',
    settings: JSON.stringify({ shared: true }),
    created_at: t,
  });
  await putInstall({ id: 'pi_filesystem', connector_id: 'filesystem', source: 'bundled', status: 'installed', enabled_projects: JSON.stringify(['p1', 'p2', 'p3']), created_at: t });
  await putInstall({ id: 'pi_atlas-memory', connector_id: 'atlas-memory', source: 'bundled', status: 'installed', enabled_projects: JSON.stringify(['p1', 'p2', 'p3']), created_at: t });
  setSetting('activeProjectId', 'p1');
  setSetting('selectedModel', 'haiku');
  // userName is deliberately NOT seeded. atlas.config.json holds a single global
  // name, but settings are per-account — seeding it stamped the primary
  // account's owner onto every workspace that first-booted. Left unset, the UI
  // greets generically until this account's own name is known.
  setSetting('seeded', '3');
  log('seeded first-boot fixtures (dynamo)');
}
