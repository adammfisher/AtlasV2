import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, newId, now } from '../db/db.js';

export interface CheckStep {
  state: 'ok' | 'warn' | 'pending';
  label: string;
  detail?: string;
}

export function versionDir(projectId: string, artifactId: string, version: number): string {
  const dir = path.join(config.dataDir, 'artifacts', projectId, artifactId, `v${version}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface VersionInput {
  payload: unknown;
  meta: string;
  validation: CheckStep[];
  /** primary file (single-file kinds) or the version dir (multi-file kinds) */
  filePath: string;
}

export function createArtifact(
  projectId: string,
  name: string,
  kind: string,
): { id: string } {
  const id = newId('a');
  getDb()
    .prepare(
      'INSERT INTO artifacts (id, project_id, name, kind, current_version, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    )
    .run(id, projectId, name, kind, now());
  return { id };
}

export function addVersion(artifactId: string, input: VersionInput): number {
  const db = getDb();
  const row = db.prepare('SELECT current_version FROM artifacts WHERE id = ?').get(artifactId) as
    | { current_version: number }
    | undefined;
  if (!row) throw new Error(`artifact not found: ${artifactId}`);
  const next =
    (db
      .prepare('SELECT MAX(version) AS v FROM artifact_versions WHERE artifact_id = ?')
      .get(artifactId) as { v: number | null }).v ?? 0;
  const version = next + 1;
  db.prepare(
    'INSERT INTO artifact_versions (id, artifact_id, version, file_path, meta, validation, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    newId('av'),
    artifactId,
    version,
    input.filePath,
    input.meta,
    JSON.stringify(input.validation),
    JSON.stringify(input.payload),
    now(),
  );
  db.prepare('UPDATE artifacts SET current_version = ? WHERE id = ?').run(version, artifactId);
  return version;
}

export function latestPayload(artifactId: string): { payload: unknown; version: number } | null {
  const db = getDb();
  const art = db.prepare('SELECT current_version FROM artifacts WHERE id = ?').get(artifactId) as
    | { current_version: number }
    | undefined;
  if (!art) return null;
  const row = db
    .prepare('SELECT payload FROM artifact_versions WHERE artifact_id = ? AND version = ?')
    .get(artifactId, art.current_version) as { payload: string | null } | undefined;
  if (!row?.payload) return null;
  return { payload: JSON.parse(row.payload), version: art.current_version };
}

/** Find the most recent artifact of a skill kind referenced by this conversation's pipeline messages. */
export function lastPipelineArtifact(
  conversationId: string,
): { artifactId: string; kind: string; name: string } | null {
  const rows = getDb()
    .prepare(
      "SELECT payload FROM messages WHERE conversation_id = ? AND kind = 'pipeline' ORDER BY created_at DESC",
    )
    .all(conversationId) as Array<{ payload: string }>;
  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as {
      artifact?: { artifactId?: string; kind?: string; name?: string };
    };
    const ref = parsed.artifact;
    if (ref?.artifactId && ref.kind && ref.name) {
      return { artifactId: ref.artifactId, kind: ref.kind, name: ref.name };
    }
  }
  return null;
}

export function writeVersionFiles(
  dir: string,
  files: Record<string, string>,
): string {
  for (const [rel, content] of Object.entries(files)) {
    const safe = rel.replace(/^\/+/, '');
    const full = path.resolve(dir, safe);
    if (!full.startsWith(path.resolve(dir) + path.sep)) {
      throw new Error(`file path escapes version dir: ${rel}`);
    }
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
