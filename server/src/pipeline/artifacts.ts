import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { newId, now } from '../db/db.js';
import {
  getArtifactRow,
  putArtifact,
  listVersions,
  getVersion,
  putVersion,
  setArtifactCurrentVersion,
  listMessages,
} from '../db/appdb.js';

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

export async function createArtifact(
  projectId: string,
  name: string,
  kind: string,
): Promise<{ id: string }> {
  const id = newId('a');
  await putArtifact({ id, project_id: projectId, name, kind, current_version: 0, created_at: now() });
  return { id };
}

export async function addVersion(artifactId: string, input: VersionInput): Promise<number> {
  const row = await getArtifactRow(artifactId);
  if (!row) throw new Error(`artifact not found: ${artifactId}`);
  const versions = await listVersions(artifactId);
  const next = versions.reduce((max, v) => Math.max(max, v.version), 0);
  const version = next + 1;
  await putVersion({
    id: newId('av'),
    artifact_id: artifactId,
    version,
    file_path: input.filePath,
    meta: input.meta,
    validation: JSON.stringify(input.validation),
    payload: JSON.stringify(input.payload),
    created_at: now(),
  });
  await setArtifactCurrentVersion(artifactId, version);
  return version;
}

export async function latestPayload(artifactId: string): Promise<{ payload: unknown; version: number } | null> {
  const art = await getArtifactRow(artifactId);
  if (!art) return null;
  const row = await getVersion(artifactId, art.current_version);
  if (!row?.payload) return null;
  return { payload: JSON.parse(row.payload), version: art.current_version };
}

/** Find the most recent artifact of a skill kind referenced by this conversation's pipeline messages. */
export async function lastPipelineArtifact(
  conversationId: string,
): Promise<{ artifactId: string; kind: string; name: string } | null> {
  const rows = (await listMessages(conversationId))
    .filter((m) => m.kind === 'pipeline')
    .reverse(); // listMessages sorts ascending — newest first here
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
