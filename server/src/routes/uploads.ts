/**
 * Chat attachments: images (Claude vision), office files, PDFs, markdown —
 * anything the skills can read. Files land in dataDir/uploads/ for fast local
 * extraction AND mirror to S3 (atlasv2-uploads) for durability; the chat chip
 * offers a hover-download that streams the original back from S3 (local
 * fallback when S3 is unreachable). Document kinds are text-extracted at
 * upload time so chat can inject contents without re-parsing.
 *
 * Extraction is AWAITED before the upload responds and its result is cached in
 * S3 beside the file. Both matter in Lambda: work started after the response is
 * frozen and never finishes, and dataDir is /tmp — per-container, so a later
 * message on a fresh instance would find no extraction at all.
 */
import { Router, json } from 'express';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromIni } from '@aws-sdk/credential-providers';
import { config } from '../config.js';
import { bedrockSettings } from '../providers/bedrock.js';
import { logTo } from '../log.js';
import { extractOffice, OFFICE_EXTS, type OfficeExtract } from '../office/extract.js';

const UPLOADS_BUCKET = 'atlasv2-uploads-683032473658';

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    const s = bedrockSettings();
    _s3 = new S3Client({ region: s.region || 'us-east-1', ...(process.env.AWS_LAMBDA_FUNCTION_NAME ? {} : { credentials: fromIni({ profile: s.profile || 'default' }) }) });
  }
  return _s3;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// claude.ai-parity document set: office (incl. legacy), data, ebooks, and code
const TEXT_EXTS = ['.csv', '.tsv', '.md', '.txt', '.json', '.html', '.xml', '.yaml', '.yml', '.log', '.ipynb'];
const CODE_EXTS = ['.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rb', '.rs', '.php', '.swift', '.kt', '.sql', '.sh', '.css'];
const DOC_EXTS = new Set([...OFFICE_EXTS, ...TEXT_EXTS, ...CODE_EXTS]);

export type AttachmentKind = 'image' | 'document';

export interface AttachmentMeta {
  id: string;
  name: string;
  kind: AttachmentKind;
  size: number;
}

function uploadDir(): string {
  const dir = path.join(config.dataDir, 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function attachmentPath(id: string): string {
  // ids are uuid-name slugs generated here — refuse anything path-shaped
  if (id.includes('/') || id.includes('..')) throw new Error('bad attachment id');
  return path.join(uploadDir(), id);
}

/** Ensure the original bytes exist locally, pulling them back from S3 when this
 * container never saw the upload (Lambda /tmp is per-instance). */
export async function hydrateAttachment(id: string): Promise<boolean> {
  const local = attachmentPath(id);
  if (existsSync(local)) return true;
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: UPLOADS_BUCKET, Key: `uploads/${id}` }));
    writeFileSync(local, Buffer.from(await out.Body!.transformToByteArray()));
    logTo('app', `attachment hydrated from s3: ${id}`);
    return true;
  } catch (err) {
    logTo('app', `attachment hydrate failed ${id}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/** Cached extraction lives beside the upload in S3 so it survives the container
 * that produced it; the local copy is just a fast path for repeat reads. */
function cacheKey(id: string): string {
  return `uploads/${id}.extract.json`;
}
function cachePath(id: string): string {
  return `${attachmentPath(id)}.extract.json`;
}

/** What an attachment's content came out as — an explicit failure rather than a
 * null, so callers can tell the user WHY a file couldn't be read. */
export type AttachmentContent =
  | { ok: true; text: string; extract: OfficeExtract | null }
  | { ok: false; error: string };

type CachedExtract = { ok: true; extract: OfficeExtract } | { ok: false; error: string };

async function readCache(id: string): Promise<CachedExtract | null> {
  const local = cachePath(id);
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8')) as CachedExtract;
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: UPLOADS_BUCKET, Key: cacheKey(id) }));
    const raw = await out.Body!.transformToString();
    writeFileSync(local, raw); // warm this container for the rest of the conversation
    return JSON.parse(raw) as CachedExtract;
  } catch {
    return null;
  }
}

/** Only SUCCESS is cached durably. A failure is cached on this container alone,
 * so one message doesn't re-parse a broken file repeatedly, but a later message
 * gets a real retry — mirroring failures to S3 would make a transient blip
 * (throttle, cold start, S3 hiccup) permanent for the life of the upload. */
async function writeCache(id: string, value: CachedExtract): Promise<void> {
  const raw = JSON.stringify(value);
  writeFileSync(cachePath(id), raw);
  if (!value.ok) return;
  await s3()
    .send(new PutObjectCommand({ Bucket: UPLOADS_BUCKET, Key: cacheKey(id), Body: raw, ContentType: 'application/json' }))
    .catch((err: Error) => logTo('app', `extract cache mirror failed for ${id}: ${err.message}`));
}

/**
 * Extract an office attachment and cache the result (success OR failure — a
 * cached failure is what stops every later message re-running a parse that
 * cannot work). Awaited by the upload routes: in Lambda, work kicked off after
 * the response is frozen and never runs.
 */
async function extract(id: string, ext: string): Promise<CachedExtract> {
  try {
    await hydrateAttachment(id); // no-op right after upload; matters on a re-read
    const result = await extractOffice({
      file: attachmentPath(id),
      ext,
      s3: { bucket: UPLOADS_BUCKET, key: `uploads/${id}` },
    });
    const value: CachedExtract = { ok: true, extract: result };
    await writeCache(id, value);
    return value;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logTo('app', `attachment extraction failed for ${id}: ${error}`);
    const value: CachedExtract = { ok: false, error };
    await writeCache(id, value);
    return value;
  }
}

/** Full structured extraction for an attachment (slides/sheets/blocks), from
 * cache when present, extracting on demand when it isn't. */
export async function attachmentExtract(id: string): Promise<CachedExtract | null> {
  const ext = path.extname(id).toLowerCase();
  if (!OFFICE_EXTS.includes(ext)) return null;
  return (await readCache(id)) ?? (await extract(id, ext));
}

/** An attachment's readable content, or an honest reason it has none. */
export async function attachmentContent(id: string): Promise<AttachmentContent> {
  const ext = path.extname(id).toLowerCase();
  // plain-text kinds (incl. code) read directly — no extraction pass needed
  if (TEXT_EXTS.includes(ext) || CODE_EXTS.includes(ext)) {
    if (!(await hydrateAttachment(id))) {
      return { ok: false, error: 'the file is no longer available to read — upload it again' };
    }
    return { ok: true, text: readFileSync(attachmentPath(id), 'utf8'), extract: null };
  }
  const cached = await attachmentExtract(id);
  if (!cached) return { ok: false, error: `${ext || 'this file type'} can't be read as text` };
  return cached.ok ? { ok: true, text: cached.extract.text, extract: cached.extract } : cached;
}

export async function attachmentDataUrl(id: string): Promise<string> {
  if (!(await hydrateAttachment(id))) throw new Error(`image ${id} is no longer available`);
  const ext = path.extname(id).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${readFileSync(attachmentPath(id)).toString('base64')}`;
}

export const uploadsRouter = Router();

// attachments are base64 JSON — own parser with a bigger limit than the app default
uploadsRouter.post('/', json({ limit: '40mb' }), (req, res) => {
  const { name, dataBase64, projectId } = req.body as { name?: string; dataBase64?: string; projectId?: string };
  if (!name || !dataBase64) {
    res.status(400).json({ error: 'name and dataBase64 are required' });
    return;
  }
  const ext = path.extname(name).toLowerCase();
  const kind: AttachmentKind | null = IMAGE_EXTS.has(ext) ? 'image' : DOC_EXTS.has(ext) ? 'document' : null;
  if (!kind) {
    res.status(400).json({ error: `unsupported file type: ${ext || '(none)'} — images, office files, PDFs and text formats are accepted` });
    return;
  }
  const safe = name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(-80);
  const id = `${randomUUID().slice(0, 8)}-${safe}`;
  const buf = Buffer.from(dataBase64, 'base64');
  writeFileSync(attachmentPath(id), buf);
  const meta: AttachmentMeta = { id, name: safe, kind, size: buf.length };

  void (async () => {
    // durable copy in S3 — AWAITED: it is what hydration and the extract cache
    // read back on a later container, and post-response work never runs here
    await s3()
      .send(new PutObjectCommand({ Bucket: UPLOADS_BUCKET, Key: `uploads/${id}`, Body: buf }))
      .then(() => logTo('app', `attachment mirrored to s3://${UPLOADS_BUCKET}/uploads/${id}`))
      .catch((err: Error) => logTo('app', `attachment s3 mirror failed for ${id}: ${err.message}`));

    if (kind === 'document' && OFFICE_EXTS.includes(ext)) {
      // awaited, and it caches its own failure — chat reports the real reason
      await extract(id, ext);
    }

    // claude.ai parity: a document attached inside a PROJECT becomes project
    // knowledge, so every chat in the project can recall it. Indexing is awaited
    // here (Lambda-safe) and deduped by name. Skipped for scratch (no project).
    if (kind === 'document' && projectId) {
      try {
        const { addKnowledge, listKnowledge } = await import('../memory/knowledge.js');
        const existing = await listKnowledge(projectId).catch(() => []);
        if (!existing.some((f) => f.name === safe)) {
          const row = await addKnowledge(projectId, safe, buf);
          logTo('app', `attachment ${safe} → project ${projectId} knowledge (${row.status})`);
        }
      } catch (err) {
        logTo('app', `attachment→knowledge failed for ${safe}: ${err instanceof Error ? err.message : err}`);
      }
    }
    logTo('app', `attachment uploaded: ${id} (${kind}, ${buf.length}B)`);
    res.json(meta);
  })().catch((err: Error) => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  });
});

/** Large-file uploads bypass the ~6MB Lambda request cap: the browser PUTs the
 * file straight to S3 via a presigned URL, then calls /finalize to register it.
 * presign → { id, name, url }. Client PUTs bytes to `url`, then POSTs /finalize. */
uploadsRouter.post('/presign', json(), (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const ext = path.extname(name).toLowerCase();
  if (!IMAGE_EXTS.has(ext) && !DOC_EXTS.has(ext)) {
    res.status(400).json({ error: `unsupported file type: ${ext || '(none)'}` });
    return;
  }
  const safe = name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(-80);
  const id = `${randomUUID().slice(0, 8)}-${safe}`;
  void getSignedUrl(s3(), new PutObjectCommand({ Bucket: UPLOADS_BUCKET, Key: `uploads/${id}` }), { expiresIn: 600 })
    .then((url) => res.json({ id, name: safe, url }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Register a file already PUT to S3 (from /presign). Downloads it into the
 * attachment store + (in a project) indexes it as project knowledge. */
uploadsRouter.post('/finalize', json(), (req, res) => {
  const { id, name, projectId, forKnowledge } = req.body as {
    id?: string;
    name?: string;
    projectId?: string;
    forKnowledge?: boolean;
  };
  if (!id || !name) {
    res.status(400).json({ error: 'id and name are required' });
    return;
  }
  if (id.includes('/') || id.includes('..')) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const ext = path.extname(name).toLowerCase();
  const kind: AttachmentKind = IMAGE_EXTS.has(ext) ? 'image' : 'document';
  void (async () => {
    const out = await s3().send(new GetObjectCommand({ Bucket: UPLOADS_BUCKET, Key: `uploads/${id}` }));
    const buf = Buffer.from(await out.Body!.transformToByteArray());
    // knowledge-only upload (Files panel): index and return the knowledge row
    if (forKnowledge && projectId) {
      const { addKnowledge } = await import('../memory/knowledge.js');
      res.json(await addKnowledge(projectId, name, buf));
      return;
    }
    // chat attachment: stage locally for extraction, extract office docs, and
    // (in a project) promote to project knowledge
    writeFileSync(attachmentPath(id), buf);
    if (kind === 'document' && OFFICE_EXTS.includes(ext)) {
      await extract(id, ext);
    }
    if (kind === 'document' && projectId) {
      try {
        const { addKnowledge, listKnowledge } = await import('../memory/knowledge.js');
        const existing = await listKnowledge(projectId).catch(() => []);
        if (!existing.some((f) => f.name === name)) await addKnowledge(projectId, name, buf);
      } catch (err) {
        logTo('app', `finalize→knowledge failed for ${name}: ${err instanceof Error ? err.message : err}`);
      }
    }
    res.json({ id, name: name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(-80), kind, size: buf.length } satisfies AttachmentMeta);
  })().catch((err: Error) => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  });
});

/** Project knowledge upload — lives on this router because it carries base64
 * file bodies and needs the 40mb parser (the global json limit is 2mb). */
uploadsRouter.post('/knowledge', json({ limit: '40mb' }), (req, res) => {
  const { projectId, name, dataBase64 } = req.body as { projectId?: string; name?: string; dataBase64?: string };
  if (!projectId || !name || !dataBase64) {
    res.status(400).json({ error: 'projectId, name and dataBase64 are required' });
    return;
  }
  const ext = path.extname(name).toLowerCase();
  if (!DOC_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) {
    res.status(400).json({ error: `unsupported file type: ${ext || '(none)'}` });
    return;
  }
  import('../memory/knowledge.js')
    .then(({ addKnowledge }) => addKnowledge(projectId, name, Buffer.from(dataBase64, 'base64')))
    .then((row) => res.json(row))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Pull an uploaded file back down (the chip's hover-download). S3 is the
 * source of truth; the local copy covers S3 outages and pre-S3 uploads. */
uploadsRouter.get('/:id/download', (req, res) => {
  const id = req.params.id;
  if (id.includes('/') || id.includes('..')) {
    res.status(400).json({ error: 'bad attachment id' });
    return;
  }
  const filename = id.replace(/^[0-9a-f]{8}-/, '');
  s3()
    .send(new GetObjectCommand({ Bucket: UPLOADS_BUCKET, Key: `uploads/${id}` }))
    .then((out) => {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (out.ContentLength) res.setHeader('Content-Length', String(out.ContentLength));
      (out.Body as Readable).pipe(res);
    })
    .catch(() => {
      const local = attachmentPath(id);
      if (existsSync(local)) {
        res.download(local, filename);
        return;
      }
      res.status(404).json({ error: 'attachment not found' });
    });
});
