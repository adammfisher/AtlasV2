/**
 * App data layer on DynamoDB (PRD §12.1 serverless migration) — replaces
 * SQLite entirely so the platform scales to zero. Single table `atlasv2-app`:
 *
 *   SETTINGS/<key>                    · PROJECTS/<id>       · CONV/<id>
 *   MSG#<conv>/<created_at>#<id>      · ART/<id>            · ARTV#<art>/<0-pad version>
 *   SKILLS/<id>                       · PLUGINS/<id>        · PROD#<art>/<0-pad n>
 *   PROJN#<art>/<id>                  · KNOW#<project>/<id> · PENDING/<convId>
 *
 * Messages sort by sk (zero-padded created_at) so conversation order is a
 * plain Query. Settings are special-cased with a write-through in-process
 * cache: reads stay SYNCHRONOUS (they're threaded through hot sync paths like
 * bedrockSettings), writes update the cache and persist immediately. In
 * Lambda, refreshSettings() runs per request; locally a 30s sweep suffices.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import { config } from '../config.js';

const TABLE = 'atlasv2-app';

let _ddb: DynamoDBDocumentClient | null = null;
function ddb(): DynamoDBDocumentClient {
  if (!_ddb) {
    // In Lambda the execution role provides credentials; locally the profile does.
    const local = !process.env.AWS_LAMBDA_FUNCTION_NAME;
    _ddb = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: config.bedrock.region || 'us-east-1',
        ...(local ? { credentials: fromIni({ profile: config.bedrock.profile || 'default' }) } : {}),
      }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }
  return _ddb;
}

export const now = (): number => Date.now();
export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const pad = (n: number, w = 13): string => String(n).padStart(w, '0');

import { accountPrefix } from '../lib/account.js';

/** Every pk is namespaced per account — the primary account's prefix is ''
 * so pre-accounts data belongs to it (zero migration). One choke point. */
function acct(pk: string): string {
  return `${accountPrefix()}${pk}`;
}

async function queryAll(pkRaw: string, skPrefix?: string): Promise<Record<string, unknown>[]> {
  const pk = acct(pkRaw);
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb().send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
        ExclusiveStartKey: lastKey,
        ConsistentRead: true, // read-after-write correctness (edit/truncate/regenerate flows)
      }),
    );
    items.push(...((out.Items ?? []) as Record<string, unknown>[]));
    lastKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

async function getItem<T>(pkRaw: string, sk: string): Promise<T | undefined> {
  const out = await ddb().send(new GetCommand({ TableName: TABLE, Key: { pk: acct(pkRaw), sk }, ConsistentRead: true }));
  return out.Item as T | undefined;
}

async function putItem(item: Record<string, unknown>): Promise<void> {
  await ddb().send(new PutCommand({ TableName: TABLE, Item: { ...item, pk: acct(String(item.pk)) } }));
}

async function deleteItem(pkRaw: string, sk: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: TABLE, Key: { pk: acct(pkRaw), sk } }));
}

/* ---------------- settings (sync reads via write-through cache) ------------ */

// per-ACCOUNT caches — settings are workspace state (model, active project)
const settingsCaches = new Map<string, Map<string, string>>();
let settingsLoaded = false;

function settingsCache(): Map<string, string> {
  const key = accountPrefix();
  let m = settingsCaches.get(key);
  if (!m) {
    m = new Map();
    settingsCaches.set(key, m);
  }
  return m;
}

export async function loadSettings(): Promise<void> {
  const items = await queryAll('SETTINGS');
  const m = settingsCache();
  m.clear();
  for (const i of items) m.set(i.sk as string, i.value as string);
  settingsLoaded = true;
}

/** Lambda: call per request. Local: interval. Cheap (one small Query). */
export const refreshSettings = loadSettings;

export function settingsReady(): boolean {
  return settingsLoaded;
}

export function getSetting(key: string): string | null {
  return settingsCache().get(key) ?? null;
}

export function setSetting(key: string, value: string): void {
  settingsCache().set(key, value);
  void putItem({ pk: 'SETTINGS', sk: key, value }).catch((err: Error) =>
    console.error(`[appdb] setting persist failed ${key}: ${err.message}`),
  );
}

export async function setSettingSync(key: string, value: string): Promise<void> {
  settingsCache().set(key, value);
  await putItem({ pk: 'SETTINGS', sk: key, value });
}

/* ---------------- projects ---------------- */

export interface ProjectRow {
  id: string;
  name: string;
  instructions: string;
  settings: string;
  created_at: number;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const items = (await queryAll('PROJECTS')) as unknown as ProjectRow[];
  return items.sort((a, b) => a.created_at - b.created_at);
}

export async function getProject(id: string): Promise<ProjectRow | undefined> {
  return getItem<ProjectRow>('PROJECTS', id);
}

export async function putProject(p: ProjectRow): Promise<void> {
  await putItem({ pk: 'PROJECTS', sk: p.id, ...p });
}

/* ---------------- conversations ---------------- */

export interface ConversationRow {
  id: string;
  project_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  /** M9 incognito: never listed, never remembered, deleted on navigate-away */
  incognito?: boolean;
}

export async function listConversations(projectId?: string): Promise<ConversationRow[]> {
  const items = (await queryAll('CONV')) as unknown as ConversationRow[];
  const visible = items.filter((c) => !c.incognito); // M9: ghosts never list
  const filtered = projectId ? visible.filter((c) => c.project_id === projectId) : visible;
  return filtered.sort((a, b) => b.updated_at - a.updated_at);
}

export async function getConversation(id: string): Promise<ConversationRow | undefined> {
  return getItem<ConversationRow>('CONV', id);
}

export async function putConversation(c: ConversationRow): Promise<void> {
  await putItem({ pk: 'CONV', sk: c.id, ...c });
}

export async function deleteProject(id: string): Promise<void> {
  await deleteItem('PROJECTS', id);
}

export async function touchConversation(id: string, fields: Partial<Pick<ConversationRow, 'title' | 'updated_at'>>): Promise<void> {
  const sets: string[] = [];
  const vals: Record<string, unknown> = {};
  if (fields.title !== undefined) {
    sets.push('title = :t');
    vals[':t'] = fields.title;
  }
  if (fields.updated_at !== undefined) {
    sets.push('updated_at = :u');
    vals[':u'] = fields.updated_at;
  }
  if (!sets.length) return;
  await ddb().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: acct('CONV'), sk: id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeValues: vals,
      ConditionExpression: 'attribute_exists(pk)',
    }),
  );
}

export async function deleteConversation(id: string): Promise<number> {
  const msgs = await queryAll(`MSG#${id}`);
  for (const m of msgs) await deleteItem(m.pk as string, m.sk as string);
  await deleteItem('CONV', id);
  return 1;
}

/* ---------------- messages ---------------- */

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  kind: string;
  payload: string;
  created_at: number;
}

export async function listMessages(convId: string): Promise<MessageRow[]> {
  return (await queryAll(`MSG#${convId}`)) as unknown as MessageRow[]; // sk = padded created_at → ordered
}

export async function addMessage(m: MessageRow): Promise<void> {
  await putItem({ pk: `MSG#${m.conversation_id}`, sk: `${pad(m.created_at)}#${m.id}`, ...m });
}

export async function countMessages(convId: string): Promise<number> {
  return (await listMessages(convId)).length;
}

/** Delete messages after (or from, when inclusive) the anchor. Returns count. */
export async function truncateMessages(convId: string, anchorCreatedAt: number, inclusive: boolean): Promise<number> {
  const msgs = await listMessages(convId);
  const doomed = msgs.filter((m) => (inclusive ? m.created_at >= anchorCreatedAt : m.created_at > anchorCreatedAt));
  for (const m of doomed) await deleteItem(`MSG#${convId}`, `${pad(m.created_at)}#${m.id}`);
  return doomed.length;
}

export async function findMessage(convId: string, messageId: string): Promise<MessageRow | undefined> {
  return (await listMessages(convId)).find((m) => m.id === messageId);
}

/* ---------------- artifacts + versions ---------------- */

export interface ArtifactRow {
  id: string;
  project_id: string;
  conv_id?: string; // the conversation that created it (for gallery → open chat)
  name: string;
  kind: string;
  current_version: number;
  created_at: number;
}

export async function listArtifacts(projectIds?: string[]): Promise<ArtifactRow[]> {
  const items = (await queryAll('ART')) as unknown as ArtifactRow[];
  const filtered = projectIds ? items.filter((a) => projectIds.includes(a.project_id)) : items;
  return filtered.sort((a, b) => b.created_at - a.created_at);
}

export async function getArtifactRow(id: string): Promise<ArtifactRow | undefined> {
  return getItem<ArtifactRow>('ART', id);
}

export async function putArtifact(a: ArtifactRow): Promise<void> {
  await putItem({ pk: 'ART', sk: a.id, ...a });
}

export async function setArtifactCurrentVersion(id: string, version: number): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: acct('ART'), sk: id },
      UpdateExpression: 'SET current_version = :v',
      ExpressionAttributeValues: { ':v': version },
    }),
  );
}

export interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version: number;
  file_path: string | null;
  meta: string | null;
  validation: string | null;
  payload: string | null;
  created_at: number;
}

export async function listVersions(artifactId: string): Promise<ArtifactVersionRow[]> {
  return (await queryAll(`ARTV#${artifactId}`)) as unknown as ArtifactVersionRow[]; // sk padded version → ordered
}

export async function getVersion(artifactId: string, version: number): Promise<ArtifactVersionRow | undefined> {
  return getItem<ArtifactVersionRow>(`ARTV#${artifactId}`, pad(version, 6));
}

export async function putVersion(v: ArtifactVersionRow): Promise<void> {
  await putItem({ pk: `ARTV#${v.artifact_id}`, sk: pad(v.version, 6), ...v });
}

/** Delete an artifact and all its versions (product states/projections are
 * scoped under the artifact and go stale harmlessly). */
export async function deleteArtifact(id: string): Promise<void> {
  const versions = await listVersions(id);
  for (const v of versions) await deleteItem(`ARTV#${id}`, pad(v.version, 6));
  await deleteItem('ART', id);
}

/** Persist a resolved conversation link on an artifact (backfill for rows
 * created before conv_id existed). */
export async function setArtifactConversation(id: string, convId: string): Promise<void> {
  const row = await getArtifactRow(id);
  if (row) await putArtifact({ ...row, conv_id: convId });
}

/* ---------------- skills + plugins ---------------- */

export async function skillEnabledStates(): Promise<Record<string, number>> {
  const items = await queryAll('SKILLS');
  return Object.fromEntries(items.map((i) => [i.sk as string, (i.enabled as number) ?? 1]));
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<void> {
  await putItem({ pk: 'SKILLS', sk: id, enabled: enabled ? 1 : 0 });
}

export interface PluginInstallRow {
  id: string;
  connector_id: string;
  source: string;
  status: string;
  enabled_projects: string;
  config?: string | null;
  created_at: number;
}

export async function listInstalls(): Promise<PluginInstallRow[]> {
  const items = (await queryAll('PLUGINS')) as unknown as PluginInstallRow[];
  return items.sort((a, b) => a.created_at - b.created_at);
}

export async function putInstall(p: PluginInstallRow): Promise<void> {
  await putItem({ pk: 'PLUGINS', sk: p.id, ...p });
}

export async function deleteInstall(id: string): Promise<void> {
  await deleteItem('PLUGINS', id);
}

/* ---------------- product states + projections ---------------- */

export interface ProductStateRow {
  id: string;
  artifact_id: string;
  state: string;
  note: string;
  stamped_by: string | null;
  at_version: number | null;
  created_at: number;
}

export async function listProductStates(artifactId: string): Promise<ProductStateRow[]> {
  return (await queryAll(`PROD#${artifactId}`)) as unknown as ProductStateRow[];
}

export async function addProductState(s: ProductStateRow): Promise<void> {
  await putItem({ pk: `PROD#${s.artifact_id}`, sk: `${pad(s.created_at)}#${s.id}`, ...s });
}

export interface ProjectionRow {
  id: string;
  artifact_id: string;
  kind: string;
  at_version: number;
  output_ref: string | null;
  target_ref: string | null;
  status: string;
  created_at: number;
}

export async function listProjectionsFor(artifactId: string): Promise<ProjectionRow[]> {
  const items = (await queryAll(`PROJN#${artifactId}`)) as unknown as ProjectionRow[];
  return items.sort((a, b) => a.created_at - b.created_at);
}

export async function getProjection(artifactId: string, id: string): Promise<ProjectionRow | undefined> {
  return getItem<ProjectionRow>(`PROJN#${artifactId}`, id);
}

export async function putProjection(p: ProjectionRow): Promise<void> {
  await putItem({ pk: `PROJN#${p.artifact_id}`, sk: p.id, ...p });
}

/* ---------------- project knowledge registry ---------------- */

export interface KnowledgeRow {
  id: string;
  project_id: string;
  name: string;
  size: number;
  status: string;
  chunks: number;
  error: string | null;
  created_at: number;
}

export async function listKnowledgeRows(projectId: string): Promise<KnowledgeRow[]> {
  const items = (await queryAll(`KNOW#${projectId}`)) as unknown as KnowledgeRow[];
  return items.sort((a, b) => b.created_at - a.created_at);
}

export async function getKnowledgeRow(projectId: string, id: string): Promise<KnowledgeRow | undefined> {
  return getItem<KnowledgeRow>(`KNOW#${projectId}`, id);
}

export async function putKnowledgeRow(k: KnowledgeRow): Promise<void> {
  await putItem({ pk: `KNOW#${k.project_id}`, sk: k.id, ...k });
}

export async function deleteKnowledgeRow(projectId: string, id: string): Promise<void> {
  await deleteItem(`KNOW#${projectId}`, id);
}

/* ---------------- extraction queue (durable, was mem_pending) -------------- */

export interface PendingRow {
  conv_id: string;
  project_id: string;
  due_at: number;
  attempts: number;
}

export async function upsertPending(convId: string, projectId: string, dueAt: number): Promise<void> {
  await putItem({ pk: 'PENDING', sk: convId, conv_id: convId, project_id: projectId, due_at: dueAt, attempts: 0 });
}

export async function duePending(cutoff: number): Promise<PendingRow[]> {
  const items = (await queryAll('PENDING')) as unknown as PendingRow[];
  return items.filter((p) => p.due_at <= cutoff);
}

export async function bumpPending(convId: string, attempts: number, dueAt: number): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: acct('PENDING'), sk: convId },
      UpdateExpression: 'SET attempts = :a, due_at = :d',
      ExpressionAttributeValues: { ':a': attempts, ':d': dueAt },
    }),
  );
}

export async function deletePending(convId: string): Promise<void> {
  await deleteItem('PENDING', convId);
}

export async function cancelPendingForProject(projectId: string): Promise<void> {
  const items = (await queryAll('PENDING')) as unknown as PendingRow[];
  for (const p of items.filter((x) => x.project_id === projectId)) await deletePending(p.conv_id);
}
