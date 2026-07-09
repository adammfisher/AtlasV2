/**
 * Chat attachments: images (Claude vision), office files, PDFs, markdown —
 * anything the skills can read. Files land in dataDir/uploads/ for fast local
 * extraction AND mirror to S3 (atlasv2-uploads) for durability; the chat chip
 * offers a hover-download that streams the original back from S3 (local
 * fallback when S3 is unreachable). Document kinds are text-extracted at
 * upload time (markitdown) so chat can inject contents without re-parsing.
 */
import { Router, json } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { config, repoRoot } from '../config.js';
import { bedrockSettings } from '../providers/bedrock.js';
import { logTo } from '../log.js';

const execFileAsync = promisify(execFile);

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
const OFFICE_EXTS = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.rtf', '.odt', '.epub'];
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

/** Wait briefly for an in-flight extraction — a user who attaches a large
 * office file and asks about it immediately shouldn't get "still running". */
export async function attachmentTextWait(id: string, maxMs = 15_000): Promise<string | null> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const text = attachmentText(id);
    if (text !== null) return text;
    const ext = path.extname(id).toLowerCase();
    if (!OFFICE_EXTS.includes(ext)) return null; // nothing will ever appear
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function attachmentText(id: string): string | null {
  const extracted = `${attachmentPath(id)}.extracted.txt`;
  if (existsSync(extracted)) return readFileSync(extracted, 'utf8');
  const ext = path.extname(id).toLowerCase();
  // plain-text kinds (incl. code) read directly — no extraction pass needed
  if (TEXT_EXTS.includes(ext) || CODE_EXTS.includes(ext)) {
    return readFileSync(attachmentPath(id), 'utf8');
  }
  return null;
}

export function attachmentDataUrl(id: string): string {
  const ext = path.extname(id).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${readFileSync(attachmentPath(id)).toString('base64')}`;
}

async function extract(file: string): Promise<void> {
  const venv = path.join(repoRoot, 'runtimes/python/venv/bin/python');
  const { stdout } = await execFileAsync(venv, ['-m', 'markitdown', file], {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(`${file}.extracted.txt`, stdout.slice(0, 200_000));
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
    // durable copy in S3 — best-effort so uploads never block on connectivity
    s3()
      .send(new PutObjectCommand({ Bucket: UPLOADS_BUCKET, Key: `uploads/${id}`, Body: buf }))
      .then(() => logTo('app', `attachment mirrored to s3://${UPLOADS_BUCKET}/uploads/${id}`))
      .catch((err: Error) => logTo('app', `attachment s3 mirror failed for ${id}: ${err.message}`));

    if (kind === 'document' && OFFICE_EXTS.includes(ext)) {
      // extraction is best-effort and async — chat falls back to the filename if missing
      extract(attachmentPath(id)).catch((err: Error) =>
        logTo('app', `attachment extraction failed for ${id}: ${err.message}`),
      );
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
