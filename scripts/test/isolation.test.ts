/**
 * Stage 2 isolation gate (PRD §9 Stage 2 + Amendment 1 §A10).
 *
 * Runs against the REAL server (pnpm dev) and the real model — no mocks. Creates
 * data in two projects via the API plus direct rows in every project-scoped
 * table (including product_states and projections), then asserts zero
 * cross-reads through both the API and the isolation helpers, the explicit
 * opt-in behavior of the __shared__ partition, and the files-dir jail.
 */
import assert from 'node:assert/strict';
import { readdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getDb, newId, now } from '../../server/src/db/db.js';
import {
  SHARED_PARTITION,
  scopedConversations,
  scopedMessages,
  scopedArtifacts,
  scopedArtifactVersions,
  scopedMemKv,
  scopedGraphNodes,
  scopedGraphEdges,
  scopedProductStates,
  scopedProjections,
  projectFilesRoot,
} from '../../server/src/db/scoped.js';
import { config } from '../../server/src/config.js';

// AXIOM_BASE lets the isolation guarantees run against the DEPLOYED stack (parity M2)
const API = `${process.env.AXIOM_BASE ?? 'http://127.0.0.1:5175'}/api`;

async function api<T>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${p}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${p} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function sendMessage(convId: string, text: string): Promise<void> {
  const res = await fetch(`${API}/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) throw new Error(`message POST → ${res.status}`);
  const raw = await res.text(); // drain the SSE stream to completion
  if (!raw.includes('event: done')) throw new Error(`stream ended without done event:\n${raw.slice(-400)}`);
}

async function waitReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const h = await api<{ llama: { status: string } }>('/health');
      if (h.llama.status === 'ready') return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('server/llama not ready — run pnpm dev first');
}

interface Project {
  id: string;
}
interface Conversation {
  id: string;
  projectId: string;
  title: string;
}

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const cleanup: Array<() => void> = [];

async function main(): Promise<void> {
  await waitReady(120_000);
  const db = getDb();
  const t = now();

  console.log('— setup: two projects, real chat in each, rows in every scoped table');
  const pA = await api<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'ISO-A', instructions: 'Isolation test project A.' }),
  });
  const pB = await api<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'ISO-B', instructions: 'Isolation test project B.' }),
  });
  const prevActive =
    (await api<Record<string, string>>('/settings')).activeProjectId ?? 'p1';
  cleanup.push(() => {
    void fetch(`${API}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeProjectId: prevActive }),
    });
  });

  // conversation + real model message in each project
  await api('/settings', { method: 'PATCH', body: JSON.stringify({ activeProjectId: pA.id }) });
  const cA = await api<Conversation>('/conversations', { method: 'POST', body: '{}' });
  await sendMessage(cA.id, 'Reply with exactly one word: alpha');
  await api('/settings', { method: 'PATCH', body: JSON.stringify({ activeProjectId: pB.id }) });
  const cB = await api<Conversation>('/conversations', { method: 'POST', body: '{}' });
  await sendMessage(cB.id, 'Reply with exactly one word: bravo');

  // direct rows in every remaining project-scoped table, for both projects
  const ids: Record<string, { artifact: string; state: string; projection: string }> = {};
  for (const p of [pA, pB]) {
    const artifactId = newId('a');
    const stateId = newId('ps');
    const projectionId = newId('pj');
    ids[p.id] = { artifact: artifactId, state: stateId, projection: projectionId };
    db.prepare(
      "INSERT INTO artifacts (id, project_id, name, kind, current_version, created_at) VALUES (?, ?, ?, 'product', 1, ?)",
    ).run(artifactId, p.id, `iso-product-${p.id}.json`, t);
    db.prepare(
      'INSERT INTO artifact_versions (id, artifact_id, version, meta, created_at) VALUES (?, ?, 1, ?, ?)',
    ).run(`${artifactId}_v1`, artifactId, `iso meta ${p.id}`, t);
    db.prepare(
      "INSERT INTO product_states (id, artifact_id, state, note, stamped_by, at_version, created_at) VALUES (?, ?, 'proposed', '', 'isolation-test', 1, ?)",
    ).run(stateId, artifactId, t);
    db.prepare(
      "INSERT INTO projections (id, artifact_id, kind, at_version, status, created_at) VALUES (?, ?, 'concept_md', 1, 'local', ?)",
    ).run(projectionId, artifactId, t);
    db.prepare('INSERT INTO mem_kv (project_id, key, value) VALUES (?, ?, ?)').run(
      p.id,
      'iso-key',
      `secret-${p.id}`,
    );
    db.prepare(
      'INSERT INTO mem_graph_nodes (id, project_id, kind, name, props) VALUES (?, ?, ?, ?, ?)',
    ).run(newId('n'), p.id, 'entity', `node-${p.id}`, '{}');
    db.prepare(
      'INSERT INTO mem_graph_edges (src, dst, project_id, rel, props) VALUES (?, ?, ?, ?, ?)',
    ).run(`src-${p.id}`, `dst-${p.id}`, p.id, 'rel', '{}');
  }
  db.prepare('INSERT INTO mem_kv (project_id, key, value) VALUES (?, ?, ?)').run(
    SHARED_PARTITION,
    'iso-shared-key',
    'shared-value',
  );

  // files dirs
  const rootA = projectFilesRoot(pA.id);
  const rootB = projectFilesRoot(pB.id);
  writeFileSync(path.join(rootA, 'only-in-A.txt'), 'A');
  writeFileSync(path.join(rootB, 'only-in-B.txt'), 'B');

  cleanup.push(() => {
    for (const p of [pA, pB]) {
      const x = ids[p.id];
      if (!x) continue;
      db.prepare('DELETE FROM projections WHERE id = ?').run(x.projection);
      db.prepare('DELETE FROM product_states WHERE id = ?').run(x.state);
      db.prepare('DELETE FROM artifact_versions WHERE artifact_id = ?').run(x.artifact);
      db.prepare('DELETE FROM artifacts WHERE id = ?').run(x.artifact);
      db.prepare('DELETE FROM mem_kv WHERE project_id = ?').run(p.id);
      db.prepare('DELETE FROM mem_graph_nodes WHERE project_id = ?').run(p.id);
      db.prepare('DELETE FROM mem_graph_edges WHERE project_id = ?').run(p.id);
      db.prepare(
        'DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)',
      ).run(p.id);
      db.prepare('DELETE FROM conversations WHERE project_id = ?').run(p.id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
      rmSync(path.resolve(config.dataDir, 'projects', p.id), { recursive: true, force: true });
    }
    db.prepare('DELETE FROM mem_kv WHERE project_id = ? AND key = ?').run(
      SHARED_PARTITION,
      'iso-shared-key',
    );
  });

  console.log('— assertions: API surface');
  const apiConvsA = await api<Conversation[]>(`/conversations?projectId=${pA.id}`);
  check('GET /conversations?projectId=A returns only A rows', () => {
    assert.ok(apiConvsA.length >= 1);
    assert.ok(apiConvsA.every((c) => c.projectId === pA.id));
    assert.ok(apiConvsA.some((c) => c.id === cA.id));
    assert.ok(!apiConvsA.some((c) => c.id === cB.id));
  });
  const apiArtsA = await api<Array<{ id: string; projectId: string }>>(
    `/artifacts?projectId=${pA.id}`,
  );
  check('GET /artifacts?projectId=A returns only A rows', () => {
    assert.equal(apiArtsA.length, 1);
    assert.equal(apiArtsA[0]?.id, ids[pA.id]?.artifact);
  });
  const apiArtsB = await api<Array<{ id: string }>>(`/artifacts?projectId=${pB.id}`);
  check('GET /artifacts?projectId=B returns only B rows', () => {
    assert.equal(apiArtsB.length, 1);
    assert.equal(apiArtsB[0]?.id, ids[pB.id]?.artifact);
  });

  console.log('— assertions: isolation helpers (every scoped table, both directions)');
  for (const [self, other] of [
    [pA, pB],
    [pB, pA],
  ] as const) {
    const tag = self.id === pA.id ? 'A' : 'B';
    check(`conversations(${tag}) exclude the other project`, () => {
      const rows = scopedConversations(self.id);
      assert.ok(rows.every((r) => r.project_id === self.id));
      assert.ok(rows.length >= 1);
    });
    check(`messages(${tag}) exclude the other project`, () => {
      const rows = scopedMessages(self.id);
      assert.ok(rows.length >= 2); // user + assistant from the real chat
      const otherConvs = new Set(scopedConversations(other.id).map((c) => c.id));
      assert.ok(rows.every((m) => !otherConvs.has(m.conversation_id)));
    });
    check(`artifacts(${tag}) + versions exclude the other project`, () => {
      const arts = scopedArtifacts(self.id);
      assert.equal(arts.length, 1);
      assert.equal(arts[0]?.kind, 'product'); // artifacts.kind accepts 'product' (§A2)
      const versions = scopedArtifactVersions(self.id);
      assert.equal(versions.length, 1);
      assert.equal(versions[0]?.meta, `iso meta ${self.id}`);
    });
    check(`product_states(${tag}) scoped through artifact`, () => {
      const rows = scopedProductStates(self.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.id, ids[self.id]?.state);
      assert.notEqual(rows[0]?.id, ids[other.id]?.state);
    });
    check(`projections(${tag}) scoped through artifact`, () => {
      const rows = scopedProjections(self.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.id, ids[self.id]?.projection);
      assert.notEqual(rows[0]?.id, ids[other.id]?.projection);
    });
    check(`mem_kv(${tag}) excludes other project AND shared by default`, () => {
      const rows = scopedMemKv(self.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.value, `secret-${self.id}`);
    });
    check(`mem_kv(${tag}, includeShared) adds only the shared partition`, () => {
      const rows = scopedMemKv(self.id, { includeShared: true });
      assert.equal(rows.length, 2);
      const partitions = new Set(rows.map((r) => r.project_id));
      assert.deepEqual(partitions, new Set([self.id, SHARED_PARTITION]));
    });
    check(`graph nodes/edges(${tag}) exclude the other project`, () => {
      const nodes = scopedGraphNodes(self.id);
      const edges = scopedGraphEdges(self.id);
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0]?.name, `node-${self.id}`);
      assert.equal(edges.length, 1);
      assert.equal(edges[0]?.src, `src-${self.id}`);
    });
  }

  console.log('— assertions: files dirs');
  check('each files root contains only its own file', () => {
    assert.deepEqual(readdirSync(rootA), ['only-in-A.txt']);
    assert.deepEqual(readdirSync(rootB), ['only-in-B.txt']);
    assert.notEqual(rootA, rootB);
  });
  check('path escapes are rejected', () => {
    assert.throws(() => projectFilesRoot('../evil'));
    assert.throws(() => projectFilesRoot('a/../../b'));
    assert.throws(() => projectFilesRoot(''));
    assert.throws(() => projectFilesRoot('a b'));
  });

  console.log('— assertions: chat filed under the project that was active');
  check('conversation A belongs to project A (created while A active)', () => {
    assert.equal(scopedConversations(pA.id).some((c) => c.id === cA.id), true);
    assert.equal(scopedConversations(pB.id).some((c) => c.id === cA.id), false);
  });

  console.log(`\nISOLATION TEST PASS — ${passed} checks green`);
}

main()
  .catch((err) => {
    console.error('\nISOLATION TEST FAIL');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const fn of cleanup.reverse()) {
      try {
        fn();
      } catch (err) {
        console.error('cleanup error:', err);
      }
    }
  });
