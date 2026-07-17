/**
 * One-time migration: SQLite (atlas.db) → DynamoDB atlasv2-app (PRD §12.1).
 * Copies every app table; memory (mem_kv/graph/chunks) already lives in
 * atlasv2-memory and is skipped. Idempotent — puts overwrite by key.
 *
 *   npx tsx scripts/migrate-sqlite-to-dynamo.ts
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';

const DB = process.env.AXIOM_DB ?? path.join(process.env.HOME!, 'Library/Application Support/AtlasLocal/data/atlas.db');
const TABLE = 'atlasv2-app';
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-1', credentials: fromIni({ profile: 'default' }) }),
  { marshallOptions: { removeUndefinedValues: true } },
);
const db = new Database(DB, { readonly: true });
const pad = (n: number, w = 13): string => String(n).padStart(w, '0');

let count = 0;
async function put(item: Record<string, unknown>): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  count++;
}

const rows = <T>(sql: string): T[] => {
  try {
    return db.prepare(sql).all() as T[];
  } catch {
    return [];
  }
};

for (const s of rows<{ key: string; value: string }>('SELECT * FROM settings')) {
  await put({ pk: 'SETTINGS', sk: s.key, value: s.value });
}
for (const p of rows<Record<string, unknown>>('SELECT * FROM projects')) {
  await put({ pk: 'PROJECTS', sk: p.id as string, ...p });
}
for (const c of rows<Record<string, unknown>>('SELECT * FROM conversations')) {
  await put({ pk: 'CONV', sk: c.id as string, ...c });
}
for (const m of rows<Record<string, unknown>>('SELECT * FROM messages')) {
  await put({ pk: `MSG#${m.conversation_id as string}`, sk: `${pad(m.created_at as number)}#${m.id as string}`, ...m });
}
for (const a of rows<Record<string, unknown>>('SELECT * FROM artifacts')) {
  await put({ pk: 'ART', sk: a.id as string, ...a });
}
for (const v of rows<Record<string, unknown>>('SELECT * FROM artifact_versions')) {
  await put({ pk: `ARTV#${v.artifact_id as string}`, sk: pad(v.version as number, 6), ...v });
}
for (const s of rows<Record<string, unknown>>('SELECT * FROM skills_state')) {
  await put({ pk: 'SKILLS', sk: s.skill_id as string, enabled: s.enabled });
}
for (const p of rows<Record<string, unknown>>('SELECT * FROM plugin_installs')) {
  await put({ pk: 'PLUGINS', sk: p.id as string, ...p });
}
for (const s of rows<Record<string, unknown>>('SELECT * FROM product_states')) {
  await put({ pk: `PROD#${s.artifact_id as string}`, sk: `${pad(s.created_at as number)}#${s.id as string}`, ...s });
}
for (const p of rows<Record<string, unknown>>('SELECT * FROM projections')) {
  await put({ pk: `PROJN#${p.artifact_id as string}`, sk: p.id as string, ...p });
}
for (const k of rows<Record<string, unknown>>('SELECT * FROM project_knowledge')) {
  await put({ pk: `KNOW#${k.project_id as string}`, sk: k.id as string, ...k });
}
for (const m of rows<Record<string, unknown>>('SELECT * FROM mem_pending')) {
  await put({ pk: 'PENDING', sk: m.conv_id as string, ...m });
}

console.log(`migrated ${count} items from ${DB} → ${TABLE}`);
db.close();
