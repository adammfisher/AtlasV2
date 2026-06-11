/**
 * Chat attachments: images (vision via the Gemma mmproj), office files, PDFs,
 * markdown — anything the skills can read. Files land in dataDir/uploads/;
 * document kinds are text-extracted at upload time (markitdown) so chat can
 * inject their contents without re-parsing per message.
 */
import { Router, json } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config, repoRoot } from '../config.js';
import { logTo } from '../log.js';

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const DOC_EXTS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.md', '.txt', '.json', '.html']);

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

export function attachmentText(id: string): string | null {
  const extracted = `${attachmentPath(id)}.extracted.txt`;
  if (existsSync(extracted)) return readFileSync(extracted, 'utf8');
  const ext = path.extname(id).toLowerCase();
  if (['.md', '.txt', '.json', '.csv', '.html'].includes(ext)) {
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
  const { name, dataBase64 } = req.body as { name?: string; dataBase64?: string };
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

  if (kind === 'document' && ['.pdf', '.docx', '.pptx', '.xlsx'].includes(ext)) {
    // extraction is best-effort and async — chat falls back to the filename if missing
    extract(attachmentPath(id)).catch((err: Error) =>
      logTo('app', `attachment extraction failed for ${id}: ${err.message}`),
    );
  }
  logTo('app', `attachment uploaded: ${id} (${kind}, ${buf.length}B)`);
  res.json(meta);
});
