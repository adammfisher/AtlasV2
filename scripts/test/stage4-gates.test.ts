/**
 * Stage 4 deterministic gates (PRD §9 Stage 4):
 *  1. cross-project tool isolation — a connector enabled only in project B is
 *     invisible to chat in project A, and direct calls are refused
 *  2. credentials round-trip encrypted — plaintext recoverable only through the
 *     store; grep of dataDir shows no plaintext
 *  3. audit log records tool calls without contents
 * Run with the dev server stopped or running — it talks to the DB and module
 * layer directly, not HTTP.
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../../server/src/db/db.js';
import { config } from '../../server/src/config.js';
import {
  ensureBundledInstalled,
  toolsForProject,
  callTool,
  installFor,
} from '../../server/src/mcp/manager.js';
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

const db = getDb();
ensureBundledInstalled();

// --- 1. cross-project tool isolation ---
await record('isolation: filesystem enabled only in B is invisible to A', async () => {
  const install = installFor('filesystem');
  assert(install, 'filesystem install row missing');
  const original = install.enabled_projects;
  try {
    db.prepare("UPDATE plugin_installs SET enabled_projects = '[\"p2\"]' WHERE id = ?").run(install.id);
    const toolsA = await toolsForProject('p1');
    assert(
      !toolsA.some((t) => t.connectorId === 'filesystem'),
      'filesystem tools leaked into project A',
    );
    const toolsB = await toolsForProject('p2');
    assert(
      toolsB.some((t) => t.name === 'fs_list'),
      'filesystem tools missing from project B',
    );
    await assert.rejects(
      () => callTool('filesystem', 'p1', 'fs_list', { path: '.' }),
      /not enabled in this project/,
      'direct call from A should be refused',
    );
  } finally {
    db.prepare('UPDATE plugin_installs SET enabled_projects = ? WHERE id = ?').run(original, install.id);
  }
});

await record('isolation: memory rows are project-scoped', async () => {
  const install = installFor('memory');
  assert(install, 'memory install row missing');
  const original = install.enabled_projects;
  try {
    db.prepare(`UPDATE plugin_installs SET enabled_projects = '["p1","p2"]' WHERE id = ?`).run(install.id);
    const marker = `isolation-marker-${Date.now()}`;
    await callTool('memory', 'p2', 'memory_upsert', { value: `secret B fact ${marker}` });
    const fromA = await callTool('memory', 'p1', 'memory_search', { query: marker });
    assert(!fromA.includes(marker), 'project B memory leaked into project A recall');
    const fromB = await callTool('memory', 'p2', 'memory_search', { query: marker });
    assert(fromB.includes(marker), 'project B cannot recall its own memory');
  } finally {
    db.prepare('UPDATE plugin_installs SET enabled_projects = ? WHERE id = ?').run(original, install.id);
  }
});

// --- 2. credentials round-trip ---
await record('credentials: AES-GCM round-trip + no plaintext on disk or DB', () => {
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
    const inDb = db
      .prepare("SELECT COUNT(*) AS n FROM plugin_installs WHERE custom_config LIKE ? OR credentials_ref LIKE ?")
      .get(`%${secret}%`, `%${secret}%`) as { n: number };
    assert.equal(inDb.n, 0, 'plaintext credential reached the database');
  } finally {
    deleteCredential(ref);
  }
});

// --- 3. audit log shape ---
await record('audit: tool calls logged without contents', async () => {
  const install = installFor('filesystem');
  assert(install, 'filesystem install row missing');
  const needle = `audit-probe-${Date.now()}`;
  const enabled = JSON.parse(install.enabled_projects) as string[];
  if (!enabled.includes('p1')) {
    db.prepare(`UPDATE plugin_installs SET enabled_projects = '["p1"]' WHERE id = ?`).run(install.id);
  }
  await callTool('filesystem', 'p1', 'fs_write', { path: 'audit-probe.txt', content: `secret content ${needle}` });
  const log = readFileSync(path.join(config.dataDir, 'logs', 'audit.log'), 'utf8');
  assert(log.includes('fs_write'), 'fs_write not audited');
  assert(!log.includes(needle), 'audit log contains file contents');
});

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  if (!r.ok) failed++;
}
console.log(failed === 0 ? 'STAGE4 GATES PASS' : `STAGE4 GATES FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
