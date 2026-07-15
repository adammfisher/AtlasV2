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
import {
  getSetting,
  setSetting,
  listMessages,
  listProjects,
  upsertPending,
  duePending,
  deletePending,
  bumpPending,
  cancelPendingForProject,
} from '../db/appdb.js';
import { completeJson, completeText } from '../llama/json.js';
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
  listEntities,
  edgesFor,
  deleteEdge,
  searchVectors,
  getProfile,
  putProfile,
  bumpRecalled,
  purgeBySource,
  type Scope,
  type Profile,
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
- project_context / decision / learned_fact: durable facts about THIS project's work —
  requirements, specifications, scope, decisions, constraints, key people/entities and their
  attributes, and conclusions reached in the discussion.

Use graph_facts for entity relationships (X depends-on Y, A owns B, Person has-role R).

DO extract durable, specific facts that would matter to a future chat — INCLUDING conclusions,
decisions, requirements, and attributes of people/products/features that emerged in the
discussion, even when they were informed by an uploaded document or the assistant's analysis.
Turn each into a self-contained declarative sentence (e.g. "The loan calculator must support
terms of 24–72 months", "Jackie's key strength is data modeling; recommended for a technical
role"). Prefer specifics (names, numbers, decisions) over vague summaries.

Do NOT extract (these pollute memory):
- Questions the user asked ("User asked about X", "User wants to know Y") — a question is not a fact.
- Requests to remember, forget, or delete memory, or any statement about the memory system itself.
- Verbatim passages copied from a document (those already live in project knowledge) — capture the
  CONCLUSION or DECISION, not a raw excerpt.
- Conversational ephemera, pleasantries, or things true only for today.
- The assistant's OWN tool or capability state ("no web access", "cannot search", connector
  availability) — tools are per-chat settings, and storing them poisons every later chat.
- Sensitive attributes (health, politics, religion, sexuality, precise location, financial account details).

If the excerpt is only a question-and-answer with no new user-asserted fact, return empty arrays.
Values must be one short declarative sentence stating the fact itself, never "the user asked/said/wants".`;

/** Per-conversation opt-out ("don't remember this chat"). */
export function rememberEnabled(convId: string): boolean {
  return getSetting(`memoff:${convId}`) !== '1';
}

export function setRemember(convId: string, enabled: boolean): void {
  setSetting(`memoff:${convId}`, enabled ? '0' : '1');
}

/* ---------- recall ---------- */

const MIN_SIMILARITY = 0.35; // hard floor — v1's dead-threshold lesson
const KV_BUDGET = 1800; // chars
const SEMANTIC_BUDGET = 1500;
const GRAPH_BUDGET = 600;

/** Composite relevance (MEMORY_DESIGN.md §4.3): similarity dominates, recency
 * and reinforcement break ties. Confidence lands in Phase 3 — its weight is
 * redistributed to similarity until then. Old vectors without metadata get
 * neutral defaults. */
function rank(h: { score: number; created_at?: number; mention_count?: number }): number {
  const ageDays = h.created_at ? (Date.now() - h.created_at) / 86_400_000 : 30;
  const recency = Math.exp(-ageDays / 90);
  const mentions = Math.min(1, Math.log1p(h.mention_count ?? 1) / Math.log(10));
  return 0.6 * h.score + 0.25 * recency + 0.15 * mentions;
}

export async function recallContext(projectId: string, query: string): Promise<string> {
  const parts: string[] = [];
  try {
    const [userKv, projKv, userProfile, projProfile] = await Promise.all([
      listKv('user'),
      listKv(projectId),
      getProfile('user').catch(() => null),
      getProfile(projectId).catch(() => null),
    ]);
    let budget = KV_BUDGET;
    const push = (
      label: string,
      rows: Array<{ key: string; value: string; updated_at?: number }>,
      profile: Profile | null,
    ): void => {
      // synthesized profile covers everything up to its generation time; only
      // facts written AFTER it are injected raw (the delta) — compact + fresh
      if (profile) {
        const summary = profile.text.slice(0, 700);
        budget -= summary.length;
        const delta = rows.filter((r) => (r.updated_at ?? 0) > profile.generated_at);
        const lines: string[] = [];
        for (const row of delta) {
          const line = `${row.key}: ${row.value}`;
          if (budget - line.length < 0) break;
          budget -= line.length;
          lines.push(line);
        }
        parts.push(`${label} ${summary}${lines.length ? `\nRecent additions:\n${lines.join('\n')}` : ''}`);
        return;
      }
      const lines: string[] = [];
      for (const row of rows) {
        const line = `${row.key}: ${row.value}`;
        if (budget - line.length < 0) break;
        budget -= line.length;
        lines.push(line);
      }
      if (lines.length) parts.push(`${label}\n${lines.join('\n')}`);
    };
    push('About the user:', userKv, userProfile);
    push('Project memory:', projKv, projProfile);

    if (query.trim()) {
      // wider breadth (8/scope) so a second document's chunk isn't crowded out
      const [userHits, projHits] = await Promise.all([
        searchVectors('user', query, 8).catch(() => []),
        searchVectors(projectId, query, 8).catch(() => []),
      ]);
      const seen = new Set(parts.join('\n').split('\n')); // don't repeat injected KV lines
      const all = [
        ...userHits.map((h) => ({ ...h, scope: 'user' as Scope })),
        ...projHits.map((h) => ({ ...h, scope: projectId as Scope })),
      ].filter((h) => h.content && !seen.has(h.content));

      // Knowledge (project documents) gets its own reserved budget so document
      // facts surface reliably alongside conversational memory — and a lower
      // floor, since a legitimately-relevant doc chunk can sit at moderate
      // similarity for a multi-fact query.
      const knowledge = all
        .filter((h) => h.type === 'knowledge' && h.score >= 0.25)
        .sort((a, b) => rank(b) - rank(a));
      const memories = all
        .filter((h) => h.type !== 'knowledge' && h.score >= MIN_SIMILARITY)
        .sort((a, b) => rank(b) - rank(a));

      const take = (pool: typeof all, maxN: number, maxChars: number): typeof all => {
        const out: typeof all = [];
        let budget = maxChars;
        for (const h of pool) {
          if (out.length >= maxN || budget - h.content.length < 0) break;
          budget -= h.content.length;
          out.push(h);
        }
        return out;
      };
      const kChosen = take(knowledge, 4, 2400);
      const mChosen = take(memories, 3, SEMANTIC_BUDGET);

      if (mChosen.length) parts.push(`Relevant memories:\n${mChosen.map((h) => h.content).join('\n')}`);
      if (kChosen.length) {
        parts.push(
          `The following passages have ALREADY been retrieved from this project's documents for you — they are the relevant excerpts. Answer directly from them; do NOT say you will search, look up, or check files (you have no file-search tool). When you use information from a passage, cite it inline as [source: filename].\n${kChosen
            .map((h) => h.content)
            .join('\n')}`,
        );
      }
      const chosen = [...kChosen, ...mChosen];
      // recalled notes shouldn't decay — extend their ttl (fire-and-forget)
      bumpRecalled('user', chosen.filter((h) => h.scope === 'user').map((h) => h.key));
      bumpRecalled(projectId, chosen.filter((h) => h.scope !== 'user').map((h) => h.key));
    }

    // graph expansion: entities named in the message get their 1-hop
    // neighborhood injected — both directions (gsi1 reverse edges)
    if (query.trim()) {
      const entities = await listEntities(projectId).catch(() => [] as string[]);
      const q = query.toLowerCase();
      const mentioned = entities.filter((e) => q.includes(e.toLowerCase())).slice(0, 3);
      if (mentioned.length) {
        const edges = (await Promise.all(mentioned.map((e) => edgesFor(projectId, e).catch(() => [])))).flat();
        const uniq = [...new Map(edges.map((e) => [`${e.src}|${e.rel}|${e.dst}`, e])).values()];
        const lines: string[] = [];
        let gBudget = GRAPH_BUDGET;
        for (const e of uniq) {
          const line = `${e.src} —${e.rel}→ ${e.dst}`;
          if (gBudget - line.length < 0) break;
          gBudget -= line.length;
          lines.push(line);
        }
        if (lines.length) parts.push(`Entity facts:\n${lines.join('\n')}`);
      }
    }
  } catch (err) {
    logTo('memory', `recall degraded: ${err instanceof Error ? err.message : err}`);
  }
  return parts.length ? `Known context (memory):\n${parts.join('\n\n')}` : '';
}

/* ---------- automatic capture (durable queue) ----------
 * Pending extractions live in SQLite, not in-process timers — a server
 * restart used to silently drop them (observed twice during Phase 2 testing;
 * also v1's fire-and-forget lesson). A 15s sweeper runs due rows with
 * bounded retries; boot recovery is free because the rows persist. */

const IDLE_MS = 75_000;
const SWEEP_MS = 15_000;
const MAX_ATTEMPTS = 3;

/** Debounced: call after every completed exchange; extraction fires on idle.
 * Pending rows live in DynamoDB — durable across restarts AND shared with the
 * Lambda deployment (EventBridge sweeps the same queue). */
export function scheduleExtraction(convId: string, projectId: string): void {
  if (!rememberEnabled(convId)) return;
  void upsertPending(convId, projectId, Date.now() + IDLE_MS).catch((err: Error) =>
    logTo('memory', `pending enqueue failed ${convId}: ${err.message}`),
  );
}

let sweeping = false;

/** Process due extractions. Returns how many rows were handled. */
export async function sweepPendingNow(): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  let handled = 0;
  try {
    const due = await duePending(Date.now());
    for (const row of due) {
      handled++;
      try {
        await extract(row.conv_id, row.project_id);
        await deletePending(row.conv_id);
      } catch (err) {
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await deletePending(row.conv_id);
          logTo('memory', `extraction abandoned for ${row.conv_id} after ${attempts} attempts: ${err instanceof Error ? err.message : err}`);
        } else {
          await bumpPending(row.conv_id, attempts, Date.now() + attempts * 60_000); // backoff
          logTo('memory', `extraction retry ${attempts}/${MAX_ATTEMPTS} scheduled for ${row.conv_id}`);
        }
      }
    }
  } finally {
    sweeping = false;
  }
  return handled;
}

export function startExtractionQueue(): void {
  setInterval(() => void sweepPendingNow(), SWEEP_MS);
}

/** Just-in-time cross-chat memory: before recalling for a message, extract any
 * pending exchanges from OTHER chats in the same project NOW (ignoring the idle
 * debounce) so a follow-up chat sees what was just said elsewhere. The current
 * conversation is excluded (its own turn is still in the live context). */
export async function flushProjectPending(projectId: string, excludeConvId?: string): Promise<void> {
  try {
    // include not-yet-due rows (scheduled within the debounce window)
    const rows = await duePending(Date.now() + IDLE_MS + 1000).catch(() => []);
    for (const row of rows) {
      if (row.project_id !== projectId || row.conv_id === excludeConvId) continue;
      try {
        await extract(row.conv_id, row.project_id);
        await deletePending(row.conv_id);
      } catch {
        /* leave it for the periodic sweep */
      }
    }
  } catch {
    /* non-fatal */
  }
}

/** Wiping a scope's memory also cancels its queued learning — otherwise a
 * pending extraction resurrects facts minutes after the wipe. */
export function cancelPending(projectId: string): void {
  void cancelPendingForProject(projectId).catch(() => undefined);
}

export async function extract(convId: string, projectId: string): Promise<void> {
  if (!rememberEnabled(convId)) return;
  const lastSeen = getSetting(`memext:${convId}`);
  const rows = (await listMessages(convId))
    .filter((m) => m.kind === 'text')
    .slice(-8)
    .reverse() as Array<{ id: string; role: string; payload: string; created_at: number }>;
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

/* ---------- observability ---------- */

export interface RecallDebug {
  injected: string;
  hits: Array<{ content: string; score: number; rank: number; scope: string; key: string }>;
  entitiesMatched: string[];
}

/** What would this query recall, and why — the exact injected block plus every
 * vector hit with its raw similarity and composite rank. */
export async function recallDebug(projectId: string, query: string): Promise<RecallDebug> {
  const injected = await recallContext(projectId, query);
  const [userHits, projHits] = await Promise.all([
    searchVectors('user', query, 5).catch(() => []),
    searchVectors(projectId, query, 5).catch(() => []),
  ]);
  const hits = [
    ...userHits.map((h) => ({ ...h, scope: 'user' })),
    ...projHits.map((h) => ({ ...h, scope: projectId })),
  ]
    .map((h) => ({ content: h.content, score: h.score, rank: rank(h), scope: h.scope, key: h.key }))
    .sort((a, b) => b.rank - a.rank);
  const entities = await listEntities(projectId).catch(() => [] as string[]);
  const q = query.toLowerCase();
  return { injected, hits, entitiesMatched: entities.filter((e) => q.includes(e.toLowerCase())) };
}

/* ---------- consolidation (claude.ai-style refreshed profile) ---------- */

const CONSOLIDATE_STALE_MS = 24 * 3_600_000;
const CONSOLIDATE_SWEEP_MS = 6 * 3_600_000;

/** Compress a scope's memory into a synthesized profile summary. Returns the
 * new profile text, or null when the scope has nothing to summarize. */
export async function consolidate(scope: Scope): Promise<string | null> {
  const [kv, notes] = await Promise.all([listKv(scope), listNotes(scope)]);
  if (kv.length + notes.length === 0) return null;
  const who = scope === 'user' ? 'the user' : 'this project';
  const facts = [...kv.map((r) => `${r.key}: ${r.value}`), ...notes.map((n) => n.content)].join('\n');
  const text = (
    await completeText(
      [
        {
          role: 'system',
          content: `You compress a memory store into a profile summary of ${who}. Write compact plain prose (under 120 words, no markdown, no preamble) capturing the durable facts and preferences. Never invent anything. Omit sensitive attributes (health, politics, religion, sexuality, precise location, financial account details).`,
        },
        { role: 'user', content: facts.slice(0, 8000) },
      ],
      { maxTokens: 300, temperature: 0.2 },
    )
  ).trim();
  if (!text) return null;
  await putProfile(scope, text, kv.length + notes.length);
  logTo('memory', `consolidated ${scope}: profile refreshed over ${kv.length + notes.length} facts`);
  return text;
}

/** Refresh any scope whose profile is missing or >24h old. In-server timer for
 * now; moves to EventBridge Scheduler + Lambda with the Phase 4 migration. */
export async function consolidateStaleScopes(): Promise<void> {
  const projects = await listProjects();
  for (const scope of ['user', ...projects.map((p) => p.id)] as Scope[]) {
    try {
      const profile = await getProfile(scope);
      if (!profile || Date.now() - profile.generated_at > CONSOLIDATE_STALE_MS) {
        await consolidate(scope);
      }
    } catch (err) {
      logTo('memory', `consolidation sweep failed for ${scope}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

export function scheduleConsolidation(): void {
  setTimeout(() => void consolidateStaleScopes(), 90_000); // after boot settles
  setInterval(() => void consolidateStaleScopes(), CONSOLIDATE_SWEEP_MS);
}

/* ---------- browse/edit (the memory panel) ---------- */

export interface MemorySnapshot {
  kv: Array<{ key: string; value: string }>;
  notes: Array<{ id: string; content: string; created_at: number }>;
  facts: Array<{ src: string; rel: string; dst: string }>;
  profile: Profile | null;
}

export async function memorySnapshot(scope: Scope): Promise<MemorySnapshot> {
  const [kv, notes, facts, profile] = await Promise.all([
    listKv(scope),
    listNotes(scope),
    listEdges(scope),
    getProfile(scope).catch(() => null),
  ]);
  return { kv, notes, facts, profile };
}

export async function upsertKv(scope: Scope, key: string, value: string): Promise<void> {
  await putKv(scope, key, value);
}

export async function addNote(scope: Scope, content: string): Promise<string> {
  return putNote(scope, content, 'note');
}

/* ---------- explicit chat tools (remember / forget) ---------- */

export async function rememberFact(scope: Scope, fact: string, source: string): Promise<string> {
  await putNote(scope, fact.slice(0, 500), 'explicit', source);
  return `Stored ${scope === 'user' ? 'about the user (all projects)' : 'in project memory'}: "${fact.slice(0, 140)}"`;
}

export async function forgetFact(scope: Scope, query: string, projectId?: string): Promise<string> {
  // Forget across BOTH the named scope and the user scope: "forget about my X"
  // is a user-scope fact even when issued inside a project, and the model's
  // scope guess is unreliable. Delete EVERY sufficiently-matching memory in
  // each (extractor siblings included).
  const scopes = [...new Set([scope, projectId ?? scope, 'user'])];
  const forgotten: string[] = [];
  for (const s of scopes) {
    const hits = (await searchVectors(s, query, 5).catch(() => [])).filter((h) => h.score >= 0.5);
    for (const h of hits) {
      if (h.type === 'kv' && h.kvkey) await deleteKv(s, h.kvkey);
      else await deleteNote(s, h.key);
      forgotten.push(h.content.slice(0, 100));
    }
    // lexical sweep behind the vector pass: an extractor phrasing that lands
    // under the similarity bar must still die — "forget X" leaving a copy of X
    // is the one unforgivable failure mode of this tool. Requires ≥2 distinct
    // content words from the query in the stored text (or its KV key).
    const words = [...new Set(query.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [])].filter(
      (w) => !['about', 'everything', 'forget', 'remove', 'delete', 'memory', 'that', 'this', 'with'].includes(w),
    );
    if (words.length >= 2) {
      const matches = (text: string): boolean => {
        const t = text.toLowerCase();
        return words.filter((w) => t.includes(w)).length >= 2;
      };
      for (const kv of await listKv(s).catch(() => [])) {
        if (matches(`${kv.key.replace(/[._]/g, ' ')} ${kv.value}`)) {
          await deleteKv(s, kv.key);
          forgotten.push(kv.value.slice(0, 100));
        }
      }
      for (const note of await listNotes(s).catch(() => [])) {
        if (matches(note.content)) {
          await deleteNote(s, note.id);
          forgotten.push(note.content.slice(0, 100));
        }
      }
    }
  }
  if (forgotten.length === 0) return 'No matching memory found.';
  return `Forgot ${forgotten.length} memor${forgotten.length === 1 ? 'y' : 'ies'}: ${forgotten.join(' | ')}`;
}

/** M5 deletion propagation: a deleted conversation must not keep whispering.
 * Purges every note/KV it produced (user + project scope), and clears its
 * queued extraction so the sweeper can't resurrect the facts afterwards. */
export async function purgeConversationMemory(projectId: string, convId: string): Promise<number> {
  await deletePending(convId).catch(() => undefined);
  let purged = 0;
  for (const scope of new Set([projectId, 'user'])) {
    purged += await purgeBySource(scope, convId).catch(() => 0);
  }
  if (purged > 0) logTo('memory', `purged ${purged} memories derived from deleted conversation ${convId}`);
  return purged;
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
