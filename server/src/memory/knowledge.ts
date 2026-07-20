/**
 * Project knowledge files (claude.ai parity): documents uploaded to a PROJECT
 * (not a message) persist as knowledge that informs every chat in it. The file
 * mirrors to S3, its text is extracted (markitdown for office/PDF, direct read
 * for text/code), chunked paragraph-aware (~1000 chars), and each chunk is
 * embedded into the project's vector index — recall surfaces the relevant
 * chunks semantically on every message. Deleting the file removes its chunks.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import {
  listKnowledgeRows,
  getKnowledgeRow,
  putKnowledgeRow,
  deleteKnowledgeRow,
  type KnowledgeRow,
} from '../db/appdb.js';
import { config } from '../config.js';
import { bedrockSettings } from '../providers/bedrock.js';
import { logTo } from '../log.js';
import { extractOffice, type OfficeExtract } from '../office/extract.js';
import { putKnowledgeChunk, deleteKnowledgeChunks } from './store.js';

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

async function extractText(file: string, ext: string, s3Key: string): Promise<string> {
  if (!OFFICE.includes(ext)) return readFileSync(file, 'utf8');
  const { text } = await extractOffice({ file, ext, s3: { bucket: BUCKET, key: s3Key } });
  return text;
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
  // durable copy — AWAITED: extraction hands this key to the office function for
  // files past the invoke cap, and in Lambda post-response work never runs
  const key = `knowledge/${projectId}/${id}${ext}`;
  await s3()
    .send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buf }))
    .catch((err: Error) => logTo('memory', `knowledge s3 mirror failed ${id}: ${err.message}`));

  try {
    const text = await extractText(local, ext, key);
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

/** Hydrates the local staging copy from S3 when this container never staged it
 * (or a prior copy was evicted) — shared by extraction and rendering, both of
 * which need real bytes on disk regardless of which container serves them. */
async function hydrateKnowledgeFile(projectId: string, id: string): Promise<{ local: string; ext: string; key: string; name: string } | null> {
  const row = await getKnowledgeRow(projectId, id);
  if (!row) return null;
  const ext = path.extname(row.name).toLowerCase();
  const key = `knowledge/${projectId}/${id}${ext}`;
  const local = path.join(knowledgeDir(), `${id}${ext}`);
  if (!existsSync(local)) {
    const out = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    writeFileSync(local, Buffer.from(await out.Body!.transformToByteArray()));
  }
  return { local, ext, key, name: row.name };
}

/** Full structured extraction of a knowledge file (slides/sheets/blocks), for
 * on-demand reads. Hydrates the bytes from S3 when this container never staged
 * them — recall gives chunks, this gives the whole document. */
export async function knowledgeExtract(projectId: string, id: string): Promise<OfficeExtract | null> {
  const hydrated = await hydrateKnowledgeFile(projectId, id);
  if (!hydrated) return null;
  return await extractOffice({ file: hydrated.local, ext: hydrated.ext, s3: { bucket: BUCKET, key: hydrated.key } });
}

/** Local file path ready for rendering (e.g. soffice → PDF) — hydrates from S3
 * on demand, same as knowledgeExtract, just without running extraction. */
export async function knowledgeLocalFile(projectId: string, id: string): Promise<{ file: string; ext: string; name: string } | null> {
  const hydrated = await hydrateKnowledgeFile(projectId, id);
  if (!hydrated) return null;
  return { file: hydrated.local, ext: hydrated.ext, name: hydrated.name };
}

export function knowledgeBucket(): string {
  return BUCKET;
}
export function knowledgeS3(): S3Client {
  return s3();
}
