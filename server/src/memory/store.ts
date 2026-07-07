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

async function putVector(scope: Scope, key: string, content: string, meta: Record<string, string>): Promise<void> {
  await ensureIndex(scope);
  const vector = await embed(content);
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
}

export async function searchVectors(scope: Scope, query: string, topK: number): Promise<VectorHit[]> {
  await ensureIndex(scope);
  const qv = await embed(query);
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
    };
  });
}

/* ---------- KV facts (the always-injected profile) ---------- */

function kvVectorKey(key: string): string {
  return `kv_${key.toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 200)}`;
}

export async function putKv(scope: Scope, key: string, value: string, source?: string): Promise<void> {
  const now = Date.now();
  await ddb().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: scopePk(scope), sk: `KV#${key}` },
      UpdateExpression: 'SET #v = :v, updated_at = :t, created_at = if_not_exists(created_at, :t), #src = :s',
      ExpressionAttributeNames: { '#v': 'value', '#src': 'source' },
      ExpressionAttributeValues: { ':v': value, ':t': now, ':s': source ?? 'manual' },
    }),
  );
  // stable vector key → same fact re-extracted just overwrites its vector
  try {
    await putVector(scope, kvVectorKey(key), `${key}: ${value}`, { type: 'kv', kvkey: key });
  } catch (err) {
    logTo('memory', `kv vector write failed (${key}): ${err instanceof Error ? err.message : err}`);
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
}

/* ---------- notes (searchable episodic memories) ---------- */

export async function putNote(scope: Scope, content: string, category: string, source?: string): Promise<string> {
  const id = `fact_${randomUUID().slice(0, 12)}`;
  const now = Date.now();
  await ddb().send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: scopePk(scope), sk: `NOTE#${id}`, content, category, source: source ?? 'manual', created_at: now, updated_at: now, mention_count: 1 },
    }),
  );
  try {
    await putVector(scope, id, content, { type: 'note', category });
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
