/**
 * Stage 4 deterministic gates (PRD §9 Stage 4):
 *  1. cross-project tool isolation — a connector enabled only in project B is
 *     invisible to chat in project A, and direct calls are refused
 *  2. project-scoped memory isolation — a fact stored in project A is not
 *     recalled in project B
 *  3. credentials round-trip encrypted — plaintext recoverable only through the
 *     store; grep of dataDir shows no plaintext, and no install row's stored
 *     JSON contains it either
 *  4. audit log records tool calls without contents
 *
 * Runs against DynamoDB directly (no HTTP, no browser) — a fast, direct-module
 * gate complementary to (not a replacement for) the E2E coverage in
 * memory.spec.ts (M-6/M-7) and m3-m9.spec.ts.
 *
 * DynamoDB rewrite note: this script originally manipulated a `plugin_installs`
 * SQLite table directly and exercised the (now fully retired) `memory` MCP
 * connector's own `memory_upsert`/`memory_search` tools for gate 2. Both are
 * dead: `appdb.ts` replaced SQLite entirely (PRD §12.1), and `memory_upsert`/
 * `memory_search` (servers/memory.ts) write to a separate SQLite file no part
 * of the real chat pipeline ever reads — chat.ts's SHADOW_CONNECTORS hides them
 * from the model precisely because they'd shadow the real, DynamoDB+S3-Vectors
 * memory engine (`server/src/memory/engine.ts`) with a dead one. Gate 2 now
 * exercises that real engine (`upsertKv`/`recallContext`) instead.
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../server/src/config.js';
import { newId, listInstalls, putProject, deleteProject } from '../../server/src/db/appdb.js';
import {
  ensureBundledInstalled,
  enableBundledForProject,
  toolsForProject,
  callTool,
  installFor,
  type InstallRow,
} from '../../server/src/mcp/manager.js';
import { upsertKv, recallContext } from '../../server/src/memory/engine.js';
import { storeCredential, readCredential, deleteCredential } from '../../server/src/mcp/credentials.js';

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function record(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      results.push({ name, ok: true });
    })
    .catch((err: Error) => {
      results.push({ name, ok: false, detail: err.message });
    });
}

async function putInstallRow(install: InstallRow): Promise<void> {
  const { putInstall } = await import('../../server/src/db/appdb.js');
  await putInstall(install);
}

async function freshProject(label: string): Promise<string> {
  const id = newId('p');
  await putProject({ id, name: `stage4-gate ${label}`, instructions: '', settings: '{}', created_at: Date.now() });
  return id;
}

await ensureBundledInstalled();
const projA = await freshProject('A');
const projB = await freshProject('B');
// FX-11: bundled connectors are enabled for every project by default — start
// both test projects from that same default, then narrow deliberately below
await enableBundledForProject(projA);
await enableBundledForProject(projB);

// --- 1. cross-project tool isolation ---
await record('isolation: filesystem enabled only in B is invisible to A', async () => {
  const install = await installFor('filesystem');
  assert(install, 'filesystem install row missing');
  const original = install.enabled_projects;
  try {
    await putInstallRow({ ...install, enabled_projects: JSON.stringify([projB]) });
    const toolsA = await toolsForProject(projA);
    assert(!toolsA.some((t) => t.connectorId === 'filesystem'), 'filesystem tools leaked into project A');
    const toolsB = await toolsForProject(projB);
    assert(toolsB.some((t) => t.name === 'fs_list'), 'filesystem tools missing from project B');
    await assert.rejects(
      () => callTool('filesystem', projA, 'fs_list', { path: '.' }),
      /not enabled in this project/,
      'direct call from A should be refused',
    );
  } finally {
    await putInstallRow({ ...(await installFor('filesystem'))!, enabled_projects: original });
  }
});

await record('isolation: a fact remembered in project A is not recalled in project B (and vice versa)', async () => {
  const marker = `isolation-marker-${Date.now()}`;
  await upsertKv(projA, 'stage4_gate_fact', `secret A fact ${marker}`);
  const fromB = await recallContext(projB, marker);
  assert(!fromB.includes(marker), 'project A memory leaked into project B recall');
  const fromA = await recallContext(projA, marker);
  assert(fromA.includes(marker), 'project A cannot recall its own memory');
});

// --- 2. credentials round-trip ---
await record('credentials: AES-GCM round-trip + no plaintext on disk or in DynamoDB', async () => {
  const secret = `tok-${Math.random().toString(36).slice(2)}-stage4-gate`;
  const ref = storeCredential(secret);
  try {
    assert.equal(readCredential(ref), secret, 'decrypt mismatch');
    // grep the data dir for the plaintext — only the key file dir is scanned
    let grepOut = '';
    try {
      grepOut = execFileSync('grep', ['-r', '-l', secret, config.dataDir], { encoding: 'utf8' });
    } catch (err) {
      // grep exits 1 when nothing matches — that is the pass condition
      grepOut = (err as { stdout?: string }).stdout ?? '';
    }
    assert.equal(grepOut.trim(), '', `plaintext found in: ${grepOut.trim()}`);
    const installsJson = JSON.stringify(await listInstalls());
    assert(!installsJson.includes(secret), 'plaintext credential reached an install row');
  } finally {
    deleteCredential(ref);
  }
});

// --- 3. audit log shape ---
await record('audit: tool calls logged without contents', async () => {
  const needle = `audit-probe-${Date.now()}`;
  await callTool('filesystem', projA, 'fs_write', { path: 'audit-probe.txt', content: `secret content ${needle}` });
  const log = readFileSync(path.join(config.dataDir, 'logs', 'audit.log'), 'utf8');
  assert(log.includes('fs_write'), 'fs_write not audited');
  assert(!log.includes(needle), 'audit log contains file contents');
});

await deleteProject(projA).catch(() => undefined);
await deleteProject(projB).catch(() => undefined);

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  if (!r.ok) failed++;
}
console.log(failed === 0 ? 'STAGE4 GATES PASS' : `STAGE4 GATES FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
