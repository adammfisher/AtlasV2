/**
 * Holistic memory engine — Phase 1 AWS-native (Documentation/MEMORY_DESIGN.md).
 *
 * Two scopes: 'user' (cross-project facts about Adam) and per-project. Storage
 * is DynamoDB + S3 Vectors via store.ts; SQLite mem_* tables are retired.
 *
 * Capture: debounced idle extraction (~75s after the last exchange, never on
 * the chat path). Claude emits user_facts / project_facts / graph_facts via
 * constrained JSON with a sensitive-category denylist.
 *
 * Recall: USER KV + PROJECT KV (always, budget-capped) + top semantic hits for
 * the current message across both scopes. Failures degrade to '' — memory
 * never blocks chat.
 */
import { getDb, getSetting, setSetting } from '../db/db.js';
import { completeJson } from '../llama/json.js';
import { logTo } from '../log.js';
import {
  putKv,
  listKv,
  deleteKv,
  putNote,
  listNotes,
  deleteNote,
  putEdge,
  listEdges,
  deleteEdge,
  searchVectors,
  type Scope,
} from './store.js';

export const USER_CATEGORIES = ['user_preference', 'user_fact'] as const;
export const PROJECT_CATEGORIES = ['project_context', 'decision', 'learned_fact'] as const;
const ALL_CATEGORIES = [...USER_CATEGORIES, ...PROJECT_CATEGORIES];

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['memories'],
  properties: {
    memories: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'key', 'value'],
        properties: {
          category: { type: 'string', enum: ALL_CATEGORIES },
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
extract ONLY durable facts worth remembering across future conversations.

Categories:
- user_preference / user_fact: stable facts about the USER themselves (role, preferences,
  working style) — these persist across ALL projects.
- project_context / decision / learned_fact: facts about THIS project's work.

Use graph_facts for entity relationships (X depends-on Y, A owns B).

Do NOT extract: conversational ephemera, things true only today, restatements of the
assistant's own output, or sensitive attributes (health, politics, religion, sexuality,
precise location, financial account details). Empty arrays are the right answer for small
talk. Values must be one short sentence each.`;

/** Per-conversation opt-out ("don't remember this chat"). */
export function rememberEnabled(convId: string): boolean {
  return getSetting(`memoff:${convId}`) !== '1';
}

export function setRemember(convId: string, enabled: boolean): void {
  setSetting(`memoff:${convId}`, enabled ? '0' : '1');
}

/* ---------- recall ---------- */

const MIN_SIMILARITY = 0.35;

export async function recallContext(projectId: string, query: string): Promise<string> {
  const parts: string[] = [];
  try {
    const [userKv, projKv] = await Promise.all([listKv('user'), listKv(projectId)]);
    let budget = 1800; // chars — KV facts are compact
    const push = (label: string, rows: Array<{ key: string; value: string }>): void => {
      const lines: string[] = [];
      for (const row of rows) {
        const line = `${row.key}: ${row.value}`;
        if (budget - line.length < 0) break;
        budget -= line.length;
        lines.push(line);
      }
      if (lines.length) parts.push(`${label}\n${lines.join('\n')}`);
    };
    push('About the user:', userKv);
    push('Project memory:', projKv);

    if (query.trim()) {
      const [userHits, projHits] = await Promise.all([
        searchVectors('user', query, 3).catch(() => []),
        searchVectors(projectId, query, 3).catch(() => []),
      ]);
      const seen = new Set(parts.join('\n').split('\n')); // don't repeat injected KV lines
      const hits = [...userHits, ...projHits]
        .filter((h) => h.score >= MIN_SIMILARITY && h.content && !seen.has(h.content))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (hits.length) parts.push(`Relevant memories:\n${hits.map((h) => h.content).join('\n')}`);
    }
  } catch (err) {
    logTo('memory', `recall degraded: ${err instanceof Error ? err.message : err}`);
  }
  return parts.length ? `Known context (memory):\n${parts.join('\n\n')}` : '';
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
  let parsed: {
    memories?: Array<{ category: string; key: string; value: string }>;
    graph_facts?: Array<{ subject: string; relation: string; object: string }>;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    logTo('memory', `extraction emitted invalid JSON for ${convId}`);
    return;
  }

  let wrote = 0;
  for (const m of parsed.memories ?? []) {
    if (!ALL_CATEGORIES.includes(m.category as (typeof ALL_CATEGORIES)[number]) || !m.key || !m.value) continue;
    const scope: Scope = (USER_CATEGORIES as readonly string[]).includes(m.category) ? 'user' : projectId;
    const key = `${m.category}.${m.key.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 48)}`;
    await putKv(scope, key, m.value.slice(0, 280), convId);
    wrote++;
  }
  for (const f of parsed.graph_facts ?? []) {
    if (!f.subject || !f.relation || !f.object) continue;
    await putEdge(projectId, f.subject.slice(0, 80), f.relation.slice(0, 60), f.object.slice(0, 80), convId);
    wrote++;
  }
  setSetting(`memext:${convId}`, rows[rows.length - 1]?.id ?? newest.id);
  if (wrote > 0) logTo('memory', `extracted ${wrote} memories from ${convId} → user + project ${projectId}`);
}

/* ---------- browse/edit (the memory panel) ---------- */

export interface MemorySnapshot {
  kv: Array<{ key: string; value: string }>;
  notes: Array<{ id: string; content: string; created_at: number }>;
  facts: Array<{ src: string; rel: string; dst: string }>;
}

export async function memorySnapshot(scope: Scope): Promise<MemorySnapshot> {
  const [kv, notes, facts] = await Promise.all([listKv(scope), listNotes(scope), listEdges(scope)]);
  return { kv, notes, facts };
}

export async function upsertKv(scope: Scope, key: string, value: string): Promise<void> {
  await putKv(scope, key, value);
}

export async function addNote(scope: Scope, content: string): Promise<string> {
  return putNote(scope, content, 'note');
}

export async function deleteMemory(
  scope: Scope,
  kind: 'kv' | 'note' | 'fact',
  ref: { key?: string; id?: string; src?: string; rel?: string; dst?: string },
): Promise<void> {
  if (kind === 'kv' && ref.key) await deleteKv(scope, ref.key);
  else if (kind === 'note' && ref.id) await deleteNote(scope, ref.id);
  else if (kind === 'fact' && ref.src && ref.rel && ref.dst) await deleteEdge(scope, ref.src, ref.rel, ref.dst);
}
