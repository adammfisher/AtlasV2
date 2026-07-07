/**
 * AWS memory store (Documentation/MEMORY_DESIGN.md §4) — Phase 1.
 *
 * Single DynamoDB table `atlasv2-memory` (on-demand) + S3 Vectors bucket
 * `atlasv2-memory-vectors` (Titan v2, 1024-dim cosine). Two scopes:
 * 'user' (cross-project facts about the user) and a projectId. Item layout:
 *   KV fact   pk=S#u#default|S#p#<id>  sk=KV#<key>
 *   Note      pk=S#…                   sk=NOTE#<factId>
 *   Entity    pk=S#…                   sk=ENT#<name>
 *   Edge      pk=S#…#E#<src>           sk=EDGE#<rel>#<dst>   (+ gsi1 reverse)
 * gsi1 stores the mirrored edge so entity adjacency queries work both ways.
 * Every KV/note write also lands a vector (stable key for KV → natural dedupe).
 * All calls degrade gracefully: recall failures log and return empty, never
 * blocking chat.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3VectorsClient,
  CreateIndexCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
  DeleteVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import { randomUUID } from 'node:crypto';
import { bedrockSettings } from '../providers/bedrock.js';
import { completeJson } from '../llama/json.js';
import { logTo } from '../log.js';

const TABLE = 'atlasv2-memory';
const BUCKET = 'atlasv2-memory-vectors';
const EMBED_MODEL = 'amazon.titan-embed-text-v2:0';
const DIM = 1024;

export type Scope = string; // 'user' | projectId

function scopePk(scope: Scope): string {
  return scope === 'user' ? 'S#u#default' : `S#p#${scope}`;
}

function indexName(scope: Scope): string {
  const name = scope === 'user' ? 'user-mem' : `proj-${scope}-mem`;
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);
}

/* ---------- clients (lazy, credentials follow the Bedrock profile) ---------- */

let _ddb: DynamoDBDocumentClient | null = null;
let _vec: S3VectorsClient | null = null;
let _brt: BedrockRuntimeClient | null = null;

function creds() {
  const s = bedrockSettings();
  return { region: s.region || 'us-east-1', credentials: fromIni({ profile: s.profile || 'default' }) };
}

function ddb(): DynamoDBDocumentClient {
  if (!_ddb) _ddb = DynamoDBDocumentClient.from(new DynamoDBClient(creds()), { marshallOptions: { removeUndefinedValues: true } });
  return _ddb;
}
function vec(): S3VectorsClient {
  if (!_vec) _vec = new S3VectorsClient(creds());
  return _vec;
}
function brt(): BedrockRuntimeClient {
  if (!_brt) _brt = new BedrockRuntimeClient(creds());
  return _brt;
}

/* ---------- embeddings ---------- */

export async function embed(text: string): Promise<number[]> {
  const out = await brt().send(
    new InvokeModelCommand({
      modelId: EMBED_MODEL,
      contentType: 'application/json',
      body: JSON.stringify({ inputText: text.slice(0, 32000), dimensions: DIM, normalize: true }),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(out.body)) as { embedding: number[] };
  return body.embedding;
}

/* ---------- vector index management ---------- */

const ensured = new Set<string>();

/** Last PutVectors per index — a probe that comes up empty right after a write
 * retries once, covering S3 Vectors' brief indexing lag (observed: a vector
 * rewritten ~1s earlier was invisible to the next query). */
const lastVectorWrite = new Map<string, number>();
const INDEX_SETTLE_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Recent-writes buffer: S3 Vectors overwrites can stay invisible to queries
 * for many seconds, but dedup MUST see facts written moments ago (same
 * extraction batch, back-to-back edits). The last 20 vectors per index are
 * kept in-process and probed with exact cosine — deterministic, zero lag.
 * The index still covers everything older/cross-restart. */
interface RecentVec {
  key: string;
  content: string;
  embedding: number[];
  meta: Record<string, string>;
}
const recentWrites = new Map<string, RecentVec[]>();
const RECENT_CAP = 20;

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s; // Titan vectors are normalized → dot = cosine
}

function rememberWrite(scope: Scope, entry: RecentVec): void {
  const name = indexName(scope);
  const list = recentWrites.get(name) ?? [];
  const next = [entry, ...list.filter((e) => e.key !== entry.key)].slice(0, RECENT_CAP);
  recentWrites.set(name, next);
}

function evictRecent(scope: Scope, key: string): void {
  const name = indexName(scope);
  recentWrites.set(name, (recentWrites.get(name) ?? []).filter((e) => e.key !== key));
}

async function ensureIndex(scope: Scope): Promise<void> {
  const name = indexName(scope);
  if (ensured.has(name)) return;
  try {
    await vec().send(
      new CreateIndexCommand({
        vectorBucketName: BUCKET,
        indexName: name,
        dataType: 'float32',
        dimension: DIM,
        distanceMetric: 'cosine',
      }),
    );
    logTo('memory', `created vector index ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already exists|ConflictException/i.test(msg)) throw err;
  }
  ensured.add(name);
}

async function putVector(
  scope: Scope,
  key: string,
  content: string,
  meta: Record<string, string>,
  embedding?: number[],
): Promise<void> {
  await ensureIndex(scope);
  const vector = embedding ?? (await embed(content));
  await vec().send(
    new PutVectorsCommand({
      vectorBucketName: BUCKET,
      indexName: indexName(scope),
      vectors: [
        {
          key,
          data: { float32: vector },
          metadata: { ...meta, content: content.slice(0, 1500), scope: scopePk(scope) },
        },
      ],
    }),
  );
  lastVectorWrite.set(indexName(scope), Date.now());
  rememberWrite(scope, {
    key,
    content: content.slice(0, 1500),
    embedding: vector,
    meta: { ...meta, scope: scopePk(scope) },
  });
}

/** Dedup probe = exact match over the recent-writes buffer (zero lag) merged
 * with the index query, plus one settle-retry when the index is fresh. */
async function probeCandidates(
  scope: Scope,
  embedding: number[],
  accept: (h: VectorHit) => boolean,
): Promise<VectorHit[]> {
  const local: VectorHit[] = (recentWrites.get(indexName(scope)) ?? []).map((e) => ({
    key: e.key,
    content: e.content,
    score: dot(embedding, e.embedding),
    category: e.meta.category,
    type: e.meta.type,
    kvkey: e.meta.kvkey,
    created_at: e.meta.created_at ? Number(e.meta.created_at) : undefined,
    mention_count: e.meta.mention_count ? Number(e.meta.mention_count) : undefined,
  }));
  let remote = (await queryByEmbedding(scope, embedding, 3)).filter(accept);
  if (remote.length === 0 && local.filter(accept).length === 0 && Date.now() - (lastVectorWrite.get(indexName(scope)) ?? 0) < INDEX_SETTLE_MS) {
    await sleep(2000);
    remote = (await queryByEmbedding(scope, embedding, 3)).filter(accept);
  }
  const byKey = new Map<string, VectorHit>();
  for (const h of [...local.filter(accept), ...remote]) {
    const existing = byKey.get(h.key);
    if (!existing || h.score > existing.score) byKey.set(h.key, h);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

async function deleteVectors(scope: Scope, keys: string[]): Promise<void> {
  try {
    await vec().send(new DeleteVectorsCommand({ vectorBucketName: BUCKET, indexName: indexName(scope), keys }));
  } catch (err) {
    logTo('memory', `vector delete skipped (${indexName(scope)}): ${err instanceof Error ? err.message : err}`);
  }
}

export interface VectorHit {
  key: string;
  content: string;
  score: number; // 1 - cosine distance
  category?: string;
  type?: string; // 'kv' | 'note'
  kvkey?: string;
  created_at?: number;
  mention_count?: number;
}

async function queryByEmbedding(scope: Scope, qv: number[], topK: number): Promise<VectorHit[]> {
  const out = await vec().send(
    new QueryVectorsCommand({
      vectorBucketName: BUCKET,
      indexName: indexName(scope),
      queryVector: { float32: qv },
      topK,
      returnMetadata: true,
      returnDistance: true,
    }),
  );
  return (out.vectors ?? []).map((v) => {
    const meta = (v.metadata ?? {}) as Record<string, string>;
    return {
      key: v.key ?? '',
      content: meta.content ?? '',
      score: 1 - (v.distance ?? 1),
      category: meta.category,
      type: meta.type,
      kvkey: meta.kvkey,
      created_at: meta.created_at ? Number(meta.created_at) : undefined,
      mention_count: meta.mention_count ? Number(meta.mention_count) : undefined,
    };
  });
}

export async function searchVectors(scope: Scope, query: string, topK: number): Promise<VectorHit[]> {
  await ensureIndex(scope);
  const qv = await embed(query);
  return queryByEmbedding(scope, qv, topK);
}

/* ---------- KV facts (the always-injected profile) ---------- */

function kvVectorKey(key: string): string {
  return `kv_${key.toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 200)}`;
}

/** Measured on real Titan v2 embeddings (2026-07-07): near-identical
 * restatements ≥0.96; paraphrases of the same fact 0.69–0.72; a contradiction
 * with reworded value 0.587; hardest same-category negative 0.44. The floor
 * only gates whether an LLM adjudication call is spent — the verdict guards
 * against false merges — so it sits at 0.50, above the negatives with margin
 * and below every observed true-pair. Extraction is async; never chat latency. */
const AUTO_MERGE = 0.9;
const ADJUDICATE_FLOOR = 0.5;

const ADJUDICATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict'],
  properties: { verdict: { type: 'string', enum: ['same', 'different', 'contradicts'] } },
};

/** Is the candidate the same durable fact as the existing memory? */
async function adjudicate(existing: string, candidate: string): Promise<'same' | 'different' | 'contradicts'> {
  try {
    const raw = await completeJson(
      [
        {
          role: 'system',
          content:
            'You deduplicate a memory store. Compare what the two facts CLAIM — ignore their key names. ' +
            'verdict "same" = the same durable fact, possibly reworded ("prefers Terraform" / "uses Terraform for infra"). ' +
            'verdict "contradicts" = incompatible values for the same attribute ("deploys run on Fargate" vs "deploys run on EC2"; "prefers X over Y" vs "prefers Y over X"; "cadence is weekly" vs "cadence is monthly"). ' +
            'verdict "different" = genuinely distinct attributes that can both be true at once.',
        },
        { role: 'user', content: `EXISTING: ${existing}\nCANDIDATE: ${candidate}` },
      ],
      ADJUDICATE_SCHEMA,
      { maxTokens: 32, temperature: 0 },
    );
    const verdict = (JSON.parse(raw) as { verdict?: string }).verdict;
    return verdict === 'same' || verdict === 'contradicts' ? verdict : 'different';
  } catch (err) {
    logTo('memory', `adjudication failed (treating as different): ${err instanceof Error ? err.message : err}`);
    return 'different';
  }
}

function categoryOf(key: string): string {
  return key.split('.')[0] ?? '';
}

export async function putKv(scope: Scope, key: string, value: string, source?: string): Promise<void> {
  const now = Date.now();
  // Dedup-at-write: the extractor invents key names, so the same fact arrives
  // under new keys ("infra_tool" vs "infrastructure_tool_preference"). ≥0.90
  // hits auto-merge; the 0.60–0.90 same-category band is LLM-adjudicated.
  let targetKey = key;
  let embedding: number[] | undefined;
  try {
    await ensureIndex(scope);
    embedding = await embed(`${key}: ${value}`);
    const candidates = await probeCandidates(
      scope,
      embedding,
      (h) => h.type === 'kv' && !!h.kvkey && h.kvkey !== key && h.score >= ADJUDICATE_FLOOR,
    );
    const best = candidates[0];
    if (best?.kvkey) {
      // ALWAYS adjudicate — contradictions embed at ≥0.9 similarity ("prefers
      // A over B" vs "prefers B over A" measured 0.94), so a score-only
      // auto-merge would silently miss the supersede/tombstone case.
      const verdict =
        best.score >= AUTO_MERGE || categoryOf(best.kvkey) === categoryOf(key)
          ? await adjudicate(best.content, `${key}: ${value}`)
          : 'different';
      if (verdict === 'different') {
        logTo('memory', `kv adjudication: different — "${key}" vs "${best.kvkey}" (score ${best.score.toFixed(2)})`);
      }
      if (verdict === 'same' || verdict === 'contradicts') {
        targetKey = best.kvkey;
        embedding = undefined; // content changes with the merged key — re-embed below
        if (verdict === 'contradicts') {
          // supersede audit trail: keep what was believed before the flip
          await ddb().send(
            new PutCommand({
              TableName: TABLE,
              Item: {
                pk: scopePk(scope),
                sk: `TOMB#${now}#${targetKey}`,
                old_value: best.content,
                new_value: `${key}: ${value}`,
                superseded_at: now,
                source: source ?? 'manual',
              },
            }),
          );
        }
        logTo(
          'memory',
          `kv dedup(${verdict}): "${key}" → existing "${targetKey}" (score ${best.score.toFixed(2)})`,
        );
      }
    }
  } catch (err) {
    logTo('memory', `kv dedup probe skipped: ${err instanceof Error ? err.message : err}`);
  }

  const updated = await ddb().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: scopePk(scope), sk: `KV#${targetKey}` },
      UpdateExpression:
        'SET #v = :v, updated_at = :t, created_at = if_not_exists(created_at, :t), #src = :s ADD mention_count :one',
      ExpressionAttributeNames: { '#v': 'value', '#src': 'source' },
      ExpressionAttributeValues: { ':v': value, ':t': now, ':s': source ?? 'manual', ':one': 1 },
      ReturnValues: 'ALL_NEW',
    }),
  );
  // stable vector key → re-extraction of the same fact overwrites its vector
  try {
    const item = updated.Attributes ?? {};
    await putVector(
      scope,
      kvVectorKey(targetKey),
      `${targetKey}: ${value}`,
      {
        type: 'kv',
        kvkey: targetKey,
        created_at: String(item.created_at ?? now),
        mention_count: String(item.mention_count ?? 1),
      },
      embedding,
    );
  } catch (err) {
    logTo('memory', `kv vector write failed (${targetKey}): ${err instanceof Error ? err.message : err}`);
  }
}

export async function listKv(scope: Scope): Promise<Array<{ key: string; value: string; updated_at?: number }>> {
  const out = await ddb().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :kv)',
      ExpressionAttributeValues: { ':pk': scopePk(scope), ':kv': 'KV#' },
    }),
  );
  return (out.Items ?? []).map((i) => ({
    key: (i.sk as string).slice(3),
    value: i.value as string,
    updated_at: i.updated_at as number | undefined,
  }));
}

export async function deleteKv(scope: Scope, key: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: TABLE, Key: { pk: scopePk(scope), sk: `KV#${key}` } }));
  await deleteVectors(scope, [kvVectorKey(key)]);
  evictRecent(scope, kvVectorKey(key));
}

/* ---------- notes (searchable episodic memories) ---------- */

export async function putNote(scope: Scope, content: string, category: string, source?: string): Promise<string> {
  const now = Date.now();
  // Dedup-at-write: ≥0.90 auto-merges; the 0.60–0.90 band is LLM-adjudicated
  // (same measured bands as KV facts). Merge = reinforce: mention_count++,
  // newer text wins.
  let embedding: number[] | undefined;
  try {
    await ensureIndex(scope);
    embedding = await embed(content);
    const near = (
      await probeCandidates(scope, embedding, (h) => h.type === 'note' && h.score >= ADJUDICATE_FLOOR)
    )[0];
    const dup =
      near &&
      (near.score >= AUTO_MERGE || (await adjudicate(near.content, content)) !== 'different')
        ? near
        : undefined;
    if (dup) {
      const updated = await ddb().send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { pk: scopePk(scope), sk: `NOTE#${dup.key}` },
          UpdateExpression:
            'SET content = :c, updated_at = :t, #src = :s, created_at = if_not_exists(created_at, :t) ADD mention_count :one',
          ExpressionAttributeNames: { '#src': 'source' },
          ExpressionAttributeValues: { ':c': content, ':t': now, ':s': source ?? 'manual', ':one': 1 },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const item = updated.Attributes ?? {};
      await putVector(
        scope,
        dup.key,
        content,
        {
          type: 'note',
          category,
          created_at: String(item.created_at ?? now),
          mention_count: String(item.mention_count ?? 1),
        },
        embedding,
      );
      logTo('memory', `note dedup: reinforced ${dup.key} (score ${dup.score.toFixed(2)}, mentions ${String(item.mention_count)})`);
      return dup.key;
    }
  } catch (err) {
    logTo('memory', `note dedup probe skipped: ${err instanceof Error ? err.message : err}`);
  }

  const id = `fact_${randomUUID().slice(0, 12)}`;
  await ddb().send(
    new PutCommand({
      TableName: TABLE,
      // ttl (epoch SECONDS): notes decay after 90d unless recalled — recall
      // hits extend it (bumpRecalled). KV profile facts never decay.
      Item: {
        pk: scopePk(scope),
        sk: `NOTE#${id}`,
        content,
        category,
        source: source ?? 'manual',
        created_at: now,
        updated_at: now,
        mention_count: 1,
        ttl: Math.floor(now / 1000) + 90 * 86_400,
      },
    }),
  );
  try {
    await putVector(scope, id, content, { type: 'note', category, created_at: String(now), mention_count: '1' }, embedding);
  } catch (err) {
    logTo('memory', `note vector write failed (${id}): ${err instanceof Error ? err.message : err}`);
  }
  return id;
}

export async function listNotes(scope: Scope): Promise<Array<{ id: string; content: string; created_at: number }>> {
  const out = await ddb().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :n)',
      ExpressionAttributeValues: { ':pk': scopePk(scope), ':n': 'NOTE#' },
    }),
  );
  return (out.Items ?? [])
    .map((i) => ({ id: (i.sk as string).slice(5), content: i.content as string, created_at: (i.created_at as number) ?? 0 }))
    .sort((a, b) => b.created_at - a.created_at);
}

export async function deleteNote(scope: Scope, id: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: TABLE, Key: { pk: scopePk(scope), sk: `NOTE#${id}` } }));
  await deleteVectors(scope, [id]);
  evictRecent(scope, id);
}

/** Recall-reinforcement: a note that keeps getting recalled shouldn't decay.
 * Fire-and-forget from the recall path — extends ttl another 90d. */
export function bumpRecalled(scope: Scope, noteIds: string[]): void {
  const now = Date.now();
  for (const id of noteIds) {
    if (!id.startsWith('fact_')) continue; // only notes decay
    void ddb()
      .send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { pk: scopePk(scope), sk: `NOTE#${id}` },
          UpdateExpression: 'SET last_recalled_at = :t, #ttl = :ttl',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':t': now, ':ttl': Math.floor(now / 1000) + 90 * 86_400 },
        }),
      )
      .catch(() => undefined);
  }
}

/* ---------- synthesized profile (claude.ai "what Atlas knows about you") ---------- */

export interface Profile {
  text: string;
  generated_at: number;
  fact_count: number;
}

export async function getProfile(scope: Scope): Promise<Profile | null> {
  const out = await ddb().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: { ':pk': scopePk(scope), ':sk': 'PROFILE#current' },
    }),
  );
  const item = out.Items?.[0];
  if (!item) return null;
  return { text: item.text as string, generated_at: item.generated_at as number, fact_count: (item.fact_count as number) ?? 0 };
}

export async function putProfile(scope: Scope, text: string, factCount: number): Promise<void> {
  await ddb().send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: scopePk(scope), sk: 'PROFILE#current', text, generated_at: Date.now(), fact_count: factCount },
    }),
  );
}

/* ---------- entity graph (adjacency + gsi1 reverse → two-way) ---------- */

export async function putEdge(scope: Scope, src: string, rel: string, dst: string, source?: string): Promise<void> {
  const base = scopePk(scope);
  const now = Date.now();
  // entities are idempotent puts
  for (const name of [src, dst]) {
    await ddb().send(
      new PutCommand({ TableName: TABLE, Item: { pk: base, sk: `ENT#${name}`, kind: 'entity', name, updated_at: now } }),
    );
  }
  await ddb().send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `${base}#E#${src}`,
        sk: `EDGE#${rel}#${dst}`,
        gsi1pk: `${base}#E#${dst}`,
        gsi1sk: `EDGE#${rel}#${src}`,
        scope: base,
        src,
        rel,
        dst,
        source: source ?? 'manual',
        created_at: now,
      },
    }),
  );
}

export interface EdgeRow {
  src: string;
  rel: string;
  dst: string;
}

/** Entity names known in a scope (for recall-time mention matching). */
export async function listEntities(scope: Scope): Promise<string[]> {
  const out = await ddb().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :e)',
      ExpressionAttributeValues: { ':pk': scopePk(scope), ':e': 'ENT#' },
    }),
  );
  return (out.Items ?? []).map((i) => (i.sk as string).slice(4));
}

/** Both directions for one entity: outbound via pk, inbound via gsi1. */
export async function edgesFor(scope: Scope, entity: string): Promise<EdgeRow[]> {
  const base = scopePk(scope);
  const [out, inn] = await Promise.all([
    ddb().send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `${base}#E#${entity}` },
      }),
    ),
    ddb().send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': `${base}#E#${entity}` },
      }),
    ),
  ]);
  const rows = [...(out.Items ?? []), ...(inn.Items ?? [])];
  return rows.map((i) => ({ src: i.src as string, rel: i.rel as string, dst: i.dst as string }));
}

/** All edges in a scope (memory panel). Scan is fine at this scale. */
export async function listEdges(scope: Scope): Promise<EdgeRow[]> {
  const out = await ddb().send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#s = :scope AND begins_with(sk, :e)',
      ExpressionAttributeNames: { '#s': 'scope' },
      ExpressionAttributeValues: { ':scope': scopePk(scope), ':e': 'EDGE#' },
    }),
  );
  return (out.Items ?? []).map((i) => ({ src: i.src as string, rel: i.rel as string, dst: i.dst as string }));
}

export async function deleteEdge(scope: Scope, src: string, rel: string, dst: string): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: `${scopePk(scope)}#E#${src}`, sk: `EDGE#${rel}#${dst}` } }),
  );
}

/* ---------- audit + lifecycle ops ---------- */

export interface Tombstone {
  old_value: string;
  new_value: string;
  superseded_at: number;
}

export async function listTombstones(scope: Scope): Promise<Tombstone[]> {
  const out = await ddb().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':pk': scopePk(scope), ':t': 'TOMB#' },
    }),
  );
  return (out.Items ?? []).map((i) => ({
    old_value: i.old_value as string,
    new_value: i.new_value as string,
    superseded_at: (i.superseded_at as number) ?? 0,
  }));
}

/** Full scope teardown: every DynamoDB item (facts, notes, entities, edges,
 * tombstones, profile) plus the vector index. Irreversible. */
export async function wipeScope(scope: Scope): Promise<{ items: number }> {
  const base = scopePk(scope);
  let items = 0;
  // main partition (KV/NOTE/ENT/TOMB/PROFILE)
  const main = await ddb().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': base },
    }),
  );
  for (const i of main.Items ?? []) {
    await ddb().send(new DeleteCommand({ TableName: TABLE, Key: { pk: i.pk as string, sk: i.sk as string } }));
    items++;
  }
  // edge partitions (pk = S#…#E#<src>) — found via the scope attribute
  const edges = await ddb().send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#s = :scope',
      ExpressionAttributeNames: { '#s': 'scope' },
      ExpressionAttributeValues: { ':scope': base },
    }),
  );
  for (const i of edges.Items ?? []) {
    await ddb().send(new DeleteCommand({ TableName: TABLE, Key: { pk: i.pk as string, sk: i.sk as string } }));
    items++;
  }
  // vector index — drop wholesale; it lazily recreates on next write
  try {
    const { DeleteIndexCommand } = await import('@aws-sdk/client-s3vectors');
    await vec().send(new DeleteIndexCommand({ vectorBucketName: BUCKET, indexName: indexName(scope) }));
    ensured.delete(indexName(scope));
  } catch (err) {
    logTo('memory', `vector index delete skipped: ${err instanceof Error ? err.message : err}`);
  }
  recentWrites.delete(indexName(scope));
  lastVectorWrite.delete(indexName(scope));
  logTo('memory', `wiped scope ${scope}: ${items} items + vector index`);
  return { items };
}
