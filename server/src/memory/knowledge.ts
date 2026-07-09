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
import {
  listKnowledgeRows,
  getKnowledgeRow,
  putKnowledgeRow,
  deleteKnowledgeRow,
  type KnowledgeRow,
} from '../db/appdb.js';
import { config, repoRoot } from '../config.js';
import { bedrockSettings } from '../providers/bedrock.js';
import { logTo } from '../log.js';
import { putKnowledgeChunk, deleteKnowledgeChunks } from './store.js';

const execFileAsync = promisify(execFile);
const BUCKET = 'atlasv2-uploads-683032473658';
const CHUNK_CHARS = 1000;
const MAX_CHUNKS = 120;

const OFFICE = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.rtf', '.odt', '.epub'];

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    const s = bedrockSettings();
    _s3 = new S3Client({ region: s.region || 'us-east-1', ...(process.env.AWS_LAMBDA_FUNCTION_NAME ? {} : { credentials: fromIni({ profile: s.profile || 'default' }) }) });
  }
  return _s3;
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

export async function listKnowledge(projectId: string): Promise<KnowledgeFile[]> {
  return (await listKnowledgeRows(projectId)) as KnowledgeFile[];
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
  // cloud: no python — the office Lambda extracts office/pdf text
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const kind = { '.pptx': 'pptx', '.docx': 'docx', '.xlsx': 'xlsx', '.pdf': 'pdf' }[ext];
    if (!kind) return readFileSync(file, 'utf8'); // legacy .doc/.ppt/.xls — best effort
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const client = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const out = await client.send(
      new InvokeCommand({
        FunctionName: 'atlasv2-office',
        Payload: Buffer.from(JSON.stringify({ op: 'extract', kind, file_b64: readFileSync(file).toString('base64') })),
      }),
    );
    const r = JSON.parse(Buffer.from(out.Payload ?? new Uint8Array()).toString('utf8')) as { text?: string; error?: string };
    if (!r.text) throw new Error(r.error ?? 'office extract returned no text');
    return r.text.slice(0, 400_000);
  }
  const venv = path.join(repoRoot, 'runtimes/python/venv/bin/python');
  const { stdout } = await execFileAsync(venv, ['-m', 'markitdown', file], {
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.slice(0, 400_000);
}

/** Register + index a knowledge file. Indexing is AWAITED (extract → chunk →
 * embed) so it actually completes — in Lambda, fire-and-forget work after the
 * response is frozen and never finishes, which left files stuck "indexing". */
export async function addKnowledge(projectId: string, name: string, buf: Buffer): Promise<KnowledgeFile> {
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
  await putKnowledgeRow(row as KnowledgeRow).catch((err: Error) =>
    logTo('memory', `knowledge registry write failed ${id}: ${err.message}`),
  );
  // durable copy (fire-and-forget mirror is fine — the row/chunks are what matter)
  void s3()
    .send(new PutObjectCommand({ Bucket: BUCKET, Key: `knowledge/${projectId}/${id}${ext}`, Body: buf }))
    .catch((err: Error) => logTo('memory', `knowledge s3 mirror failed ${id}: ${err.message}`));

  try {
    const text = await extractText(local, ext);
    const chunks = chunkText(text);
    // embed + write chunks in parallel batches (sequential was the bottleneck
    // that blew the CloudFront timeout on large files)
    const CONCURRENCY = 6;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      await Promise.all(
        chunks.slice(i, i + CONCURRENCY).map((c, j) => putKnowledgeChunk(projectId, id, i + j, `[${safe}] ${c}`, safe)),
      );
    }
    const done = { ...row, status: 'ready' as const, chunks: chunks.length };
    await putKnowledgeRow(done as KnowledgeRow);
    logTo('memory', `knowledge indexed: ${safe} → ${chunks.length} chunks (project ${projectId})`);
    return done;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errRow = { ...row, status: 'error' as const, error: msg.slice(0, 300) };
    await putKnowledgeRow(errRow as KnowledgeRow).catch(() => undefined);
    logTo('memory', `knowledge indexing failed ${safe}: ${msg}`);
    return errRow;
  }
}

export async function removeKnowledge(projectId: string, id: string): Promise<void> {
  const row = await getKnowledgeRow(projectId, id);
  if (!row) return;
  const removed = await deleteKnowledgeChunks(projectId, id);
  const ext = path.extname(row.name).toLowerCase();
  rmSync(path.join(knowledgeDir(), `${id}${ext}`), { force: true });
  void s3()
    .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `knowledge/${projectId}/${id}${ext}` }))
    .catch(() => undefined);
  await deleteKnowledgeRow(projectId, id);
  logTo('memory', `knowledge removed: ${row.name} (${removed} chunks)`);
}

/** Download source: local staging copy when present, else the S3 original. */
export async function knowledgeSource(
  projectId: string,
  id: string,
): Promise<{ name: string; file?: string; s3Key?: string } | null> {
  const row = await getKnowledgeRow(projectId, id);
  if (!row) return null;
  const ext = path.extname(row.name).toLowerCase();
  const file = path.join(knowledgeDir(), `${id}${ext}`);
  if (existsSync(file)) return { name: row.name, file };
  return { name: row.name, s3Key: `knowledge/${projectId}/${id}${ext}` };
}

export function knowledgeBucket(): string {
  return BUCKET;
}
export function knowledgeS3(): S3Client {
  return s3();
}
