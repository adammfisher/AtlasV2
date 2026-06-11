/**
 * Holistic project memory (LibreChat-evaluation outcome, Adam-directed):
 * memory is on for every project, hard-scoped per project, captured
 * automatically after a conversation goes idle, and recalled on every chat.
 *
 * Capture: a debounced extraction pass (E4B, constrained JSON, category
 * whitelist) runs ~75s after the last exchange — never on the chat path, so
 * recall costs nothing in latency. Writes go through the same mem_* tables the
 * MCP memory server owns.
 *
 * Recall: ALL key/value facts for the project (token-capped — they are small,
 * like LibreChat's) plus top-3 FTS note hits for the current message.
 */
import { randomUUID } from 'node:crypto';
import { getDb, getSetting, setSetting } from '../db/db.js';
import { completeJson } from '../llama/json.js';
import { logTo } from '../log.js';

export const VALID_KEYS = ['user_preferences', 'learned_facts', 'project_context', 'decisions'] as const;

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['memories'],
  properties: {
    memories: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'key', 'value'],
        properties: {
          category: { type: 'string', enum: [...VALID_KEYS] },
          key: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
    graph_facts: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'relation', 'object'],
        properties: {
          subject: { type: 'string' },
          relation: { type: 'string' },
          object: { type: 'string' },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You maintain long-term memory for an assistant. From the conversation excerpt,
extract ONLY durable facts worth remembering across future conversations:
stable user preferences, decisions made, project facts, important entities and
relationships. NOT conversational ephemera, NOT things true only today, NOT
restatements of the assistant's own output. Empty arrays are the right answer
for small talk. Values must be one short sentence each. Use the graph_facts
array for entity relationships (X depends-on Y, A owns B).`;

/** Per-conversation opt-out ("don't remember this chat"). */
export function rememberEnabled(convId: string): boolean {
  return getSetting(`memoff:${convId}`) !== '1';
}

export function setRemember(convId: string, enabled: boolean): void {
  setSetting(`memoff:${convId}`, enabled ? '0' : '1');
}

/* ---------- recall ---------- */

export function recallContext(projectId: string, query: string): string {
  const db = getDb();
  const parts: string[] = [];

  const kv = db
    .prepare('SELECT key, value FROM mem_kv WHERE project_id = ? ORDER BY key LIMIT 40')
    .all(projectId) as Array<{ key: string; value: string }>;
  let budget = 1400; // chars — KV facts are compact; cap like LibreChat's tokenLimit
  for (const row of kv) {
    const line = `${row.key}: ${row.value}`;
    if (budget - line.length < 0) break;
    budget -= line.length;
    parts.push(line);
  }

  const safe = query.replace(/['"*^]/g, ' ').trim();
  if (safe) {
    try {
      const hits = db
        .prepare('SELECT content FROM mem_chunks_fts WHERE mem_chunks_fts MATCH ? AND project_id = ? LIMIT 3')
        .all(safe.split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(' OR '), projectId) as Array<{ content: string }>;
      parts.push(...hits.map((h) => h.content));
    } catch {
      // FTS table may not exist until the memory server first runs — fine
    }
  }
  return parts.length ? `Known context (project memory):\n${parts.join('\n')}` : '';
}

/* ---------- automatic capture ---------- */

const timers = new Map<string, NodeJS.Timeout>();
const IDLE_MS = 75_000;

/** Debounced: call after every completed exchange; extraction fires on idle. */
export function scheduleExtraction(convId: string, projectId: string): void {
  if (!rememberEnabled(convId)) return;
  const existing = timers.get(convId);
  if (existing) clearTimeout(existing);
  timers.set(
    convId,
    setTimeout(() => {
      timers.delete(convId);
      void extract(convId, projectId).catch((err: Error) =>
        logTo('memory', `extraction failed for ${convId}: ${err.message}`),
      );
    }, IDLE_MS),
  );
}

async function extract(convId: string, projectId: string): Promise<void> {
  if (!rememberEnabled(convId)) return;
  const db = getDb();
  const lastSeen = getSetting(`memext:${convId}`);
  const rows = db
    .prepare(
      "SELECT id, role, payload, created_at FROM messages WHERE conversation_id = ? AND kind = 'text' ORDER BY created_at DESC LIMIT 8",
    )
    .all(convId) as Array<{ id: string; role: string; payload: string; created_at: number }>;
  const newest = rows[0];
  if (!newest) return;
  if (lastSeen === newest.id) return; // nothing new since the last pass

  const excerpt = rows
    .reverse()
    .map((m) => `${m.role}: ${(JSON.parse(m.payload) as { text?: string }).text ?? ''}`.slice(0, 500))
    .join('\n');

  const raw = await completeJson(
    [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: excerpt },
    ],
    EXTRACT_SCHEMA,
    { maxTokens: 512, temperature: 0.1 },
  );
  let parsed: { memories?: Array<{ category: string; key: string; value: string }>; graph_facts?: Array<{ subject: string; relation: string; object: string }> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    logTo('memory', `extraction emitted invalid JSON for ${convId}`);
    return;
  }

  let wrote = 0;
  for (const m of parsed.memories ?? []) {
    if (!(VALID_KEYS as readonly string[]).includes(m.category) || !m.key || !m.value) continue;
    const key = `${m.category}.${m.key.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 48)}`;
    db.prepare(
      'INSERT INTO mem_kv (project_id, key, value) VALUES (?,?,?) ON CONFLICT(project_id, key) DO UPDATE SET value=excluded.value',
    ).run(projectId, key, m.value.slice(0, 280));
    wrote++;
  }
  for (const f of parsed.graph_facts ?? []) {
    if (!f.subject || !f.relation || !f.object) continue;
    const nodeId = (name: string): string => {
      const hit = db
        .prepare('SELECT id FROM mem_graph_nodes WHERE project_id = ? AND name = ?')
        .get(projectId, name) as { id: string } | undefined;
      if (hit) return hit.id;
      const id = randomUUID();
      db.prepare("INSERT INTO mem_graph_nodes (id, project_id, kind, name, props) VALUES (?,?,?,?,'{}')").run(
        id, projectId, 'entity', name,
      );
      return id;
    };
    const src = nodeId(f.subject.slice(0, 80));
    const dst = nodeId(f.object.slice(0, 80));
    const exists = db
      .prepare('SELECT 1 FROM mem_graph_edges WHERE project_id = ? AND src = ? AND dst = ? AND rel = ?')
      .get(projectId, src, dst, f.relation) as unknown;
    if (!exists) {
      db.prepare("INSERT INTO mem_graph_edges (src, dst, project_id, rel, props) VALUES (?,?,?,?,'{}')").run(
        src, dst, projectId, f.relation.slice(0, 60),
      );
      wrote++;
    }
  }
  setSetting(`memext:${convId}`, rows[rows.length - 1]?.id ?? newest.id);
  if (wrote > 0) logTo('memory', `extracted ${wrote} memories from ${convId} → project ${projectId}`);
}

/* ---------- browse/edit (the memory panel) ---------- */

export interface MemorySnapshot {
  kv: Array<{ key: string; value: string }>;
  notes: Array<{ id: string; content: string; created_at: number }>;
  facts: Array<{ src: string; rel: string; dst: string }>;
}

export function memorySnapshot(projectId: string): MemorySnapshot {
  const db = getDb();
  return {
    kv: db.prepare('SELECT key, value FROM mem_kv WHERE project_id = ? ORDER BY key').all(projectId) as MemorySnapshot['kv'],
    notes: db
      .prepare('SELECT id, content, created_at FROM mem_chunks WHERE project_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(projectId) as MemorySnapshot['notes'],
    facts: db
      .prepare(
        `SELECT a.name AS src, e.rel, b.name AS dst FROM mem_graph_edges e
         JOIN mem_graph_nodes a ON a.id = e.src JOIN mem_graph_nodes b ON b.id = e.dst
         WHERE e.project_id = ? LIMIT 200`,
      )
      .all(projectId) as MemorySnapshot['facts'],
  };
}

export function upsertKv(projectId: string, key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO mem_kv (project_id, key, value) VALUES (?,?,?) ON CONFLICT(project_id, key) DO UPDATE SET value=excluded.value')
    .run(projectId, key, value);
}

export function deleteMemory(projectId: string, kind: 'kv' | 'note' | 'fact', ref: { key?: string; id?: string; src?: string; rel?: string; dst?: string }): void {
  const db = getDb();
  if (kind === 'kv' && ref.key) {
    db.prepare('DELETE FROM mem_kv WHERE project_id = ? AND key = ?').run(projectId, ref.key);
  } else if (kind === 'note' && ref.id) {
    db.prepare('DELETE FROM mem_chunks WHERE project_id = ? AND id = ?').run(projectId, ref.id);
    try {
      db.prepare('DELETE FROM mem_chunks_fts WHERE id = ?').run(ref.id);
    } catch {
      // fts table absent until first memory-server write
    }
  } else if (kind === 'fact' && ref.src && ref.rel && ref.dst) {
    db.prepare(
      `DELETE FROM mem_graph_edges WHERE project_id = ? AND rel = ?
       AND src = (SELECT id FROM mem_graph_nodes WHERE project_id = ? AND name = ?)
       AND dst = (SELECT id FROM mem_graph_nodes WHERE project_id = ? AND name = ?)`,
    ).run(projectId, ref.rel, projectId, ref.src, projectId, ref.dst);
  }
}
