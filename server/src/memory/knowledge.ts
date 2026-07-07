/**
 * Project knowledge files (claude.ai parity): documents uploaded to a PROJECT
 * (not a message) persist as knowledge that informs every chat in it. The file
 * mirrors to S3, its text is extracted (markitdown for office/PDF, direct read
 * for text/code), chunked paragraph-aware (~1000 chars), and each chunk is
 * embedded into the project's vector index — recall surfaces the relevant
 * chunks semantically on every message. Deleting the file removes its chunks.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { getDb } from '../db/db.js';
import { config, repoRoot } from '../config.js';
import { bedrockSettings } from '../providers/bedrock.js';
import { logTo } from '../log.js';
import { putKnowledgeChunk, deleteKnowledgeChunks } from './store.js';

const execFileAsync = promisify(execFile);
const BUCKET = 'atlasv2-uploads-683032473658';
const CHUNK_CHARS = 1000;
const MAX_CHUNKS = 200;

const OFFICE = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.rtf', '.odt', '.epub'];

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    const s = bedrockSettings();
    _s3 = new S3Client({ region: s.region || 'us-east-1', credentials: fromIni({ profile: s.profile || 'default' }) });
  }
  return _s3;
}

function table(): void {
  getDb().exec(
    'CREATE TABLE IF NOT EXISTS project_knowledge (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER, status TEXT, chunks INTEGER DEFAULT 0, error TEXT, created_at INTEGER)',
  );
}

function knowledgeDir(): string {
  const dir = path.join(config.dataDir, 'knowledge');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface KnowledgeFile {
  id: string;
  project_id: string;
  name: string;
  size: number;
  status: 'indexing' | 'ready' | 'error';
  chunks: number;
  error: string | null;
  created_at: number;
}

export function listKnowledge(projectId: string): KnowledgeFile[] {
  table();
  return getDb()
    .prepare('SELECT * FROM project_knowledge WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as KnowledgeFile[];
}

/** Paragraph-aware chunking: fill up to ~CHUNK_CHARS, break on blank lines. */
export function chunkText(text: string): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paras) {
    if (current && current.length + p.length > CHUNK_CHARS) {
      chunks.push(current);
      current = '';
    }
    // an oversized single paragraph splits hard
    if (p.length > CHUNK_CHARS * 1.5) {
      for (let i = 0; i < p.length; i += CHUNK_CHARS) chunks.push(p.slice(i, i + CHUNK_CHARS));
      continue;
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) chunks.push(current);
  return chunks.slice(0, MAX_CHUNKS);
}

async function extractText(file: string, ext: string): Promise<string> {
  if (!OFFICE.includes(ext)) return readFileSync(file, 'utf8');
  const venv = path.join(repoRoot, 'runtimes/python/venv/bin/python');
  const { stdout } = await execFileAsync(venv, ['-m', 'markitdown', file], {
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.slice(0, 400_000);
}

/** Register + index a knowledge file. Returns immediately with status
 * 'indexing'; chunk embedding runs async and flips status when done. */
export function addKnowledge(projectId: string, name: string, buf: Buffer): KnowledgeFile {
  table();
  const safe = name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(-80);
  const id = randomUUID().slice(0, 12);
  const ext = path.extname(safe).toLowerCase();
  const local = path.join(knowledgeDir(), `${id}${ext}`);
  writeFileSync(local, buf);
  const row: KnowledgeFile = {
    id,
    project_id: projectId,
    name: safe,
    size: buf.length,
    status: 'indexing',
    chunks: 0,
    error: null,
    created_at: Date.now(),
  };
  getDb()
    .prepare('INSERT INTO project_knowledge (id, project_id, name, size, status, chunks, created_at) VALUES (?,?,?,?,?,0,?)')
    .run(id, projectId, safe, buf.length, 'indexing', row.created_at);

  // durable copy + async indexing
  void s3()
    .send(new PutObjectCommand({ Bucket: BUCKET, Key: `knowledge/${projectId}/${id}${ext}`, Body: buf }))
    .catch((err: Error) => logTo('memory', `knowledge s3 mirror failed ${id}: ${err.message}`));

  void (async () => {
    try {
      const text = await extractText(local, ext);
      const chunks = chunkText(text);
      for (let n = 0; n < chunks.length; n++) {
        await putKnowledgeChunk(projectId, id, n, `[${safe}] ${chunks[n]!}`, safe);
      }
      getDb().prepare("UPDATE project_knowledge SET status='ready', chunks=? WHERE id=?").run(chunks.length, id);
      logTo('memory', `knowledge indexed: ${safe} → ${chunks.length} chunks (project ${projectId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      getDb().prepare("UPDATE project_knowledge SET status='error', error=? WHERE id=?").run(msg.slice(0, 300), id);
      logTo('memory', `knowledge indexing failed ${safe}: ${msg}`);
    }
  })();
  return row;
}

export async function removeKnowledge(projectId: string, id: string): Promise<void> {
  table();
  const row = getDb().prepare('SELECT * FROM project_knowledge WHERE id = ? AND project_id = ?').get(id, projectId) as
    | KnowledgeFile
    | undefined;
  if (!row) return;
  const removed = await deleteKnowledgeChunks(projectId, id);
  const ext = path.extname(row.name).toLowerCase();
  rmSync(path.join(knowledgeDir(), `${id}${ext}`), { force: true });
  void s3()
    .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `knowledge/${projectId}/${id}${ext}` }))
    .catch(() => undefined);
  getDb().prepare('DELETE FROM project_knowledge WHERE id = ?').run(id);
  logTo('memory', `knowledge removed: ${row.name} (${removed} chunks)`);
}

/** The local file path (for the download route). */
export function knowledgePath(projectId: string, id: string): { file: string; name: string } | null {
  table();
  const row = getDb().prepare('SELECT * FROM project_knowledge WHERE id = ? AND project_id = ?').get(id, projectId) as
    | KnowledgeFile
    | undefined;
  if (!row) return null;
  const ext = path.extname(row.name).toLowerCase();
  const file = path.join(knowledgeDir(), `${id}${ext}`);
  return existsSync(file) ? { file, name: row.name } : null;
}
