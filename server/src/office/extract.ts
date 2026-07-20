/**
 * One office/PDF extraction path for the whole app (uploads, project knowledge,
 * artifact previews). Local runs the Python helper in the bundled venv; Lambda
 * has no Python at all, so it invokes the atlasv2-office function's `extract`
 * op — but both sides land in the same extract_preview(), so a deck reads
 * identically on a laptop and in the cloud.
 *
 * A synchronous invoke caps the request at 6MB and base64 inflates by 4/3, so
 * anything near that is handed over as an S3 key instead of inline bytes; the
 * office function shares the app's IAM role and reads the uploads bucket itself.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { config, repoRoot } from '../config.js';
import { logTo } from '../log.js';

const execFileAsync = promisify(execFile);

/** every document kind the app accepts as an upload */
export const OFFICE_EXTS = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.rtf', '.odt', '.epub'];

export type ExtractKind = 'pptx' | 'docx' | 'xlsx' | 'pdf';

/** the kinds extract_preview parses structurally (pure-python, no LibreOffice) */
const KIND_BY_EXT: Record<string, ExtractKind> = {
  '.pptx': 'pptx',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pdf': 'pdf',
};

export interface ChartData {
  type: string;
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}
export interface Slide {
  title: string;
  bullets: string[];
  tables?: string[][][];
  charts?: ChartData[];
  notes?: string;
}
export interface Sheet {
  name: string;
  rows: string[][];
}
export interface Block {
  style: string;
  text?: string;
  rows?: string[][];
}

export interface DeckDesign {
  slide_count: number;
  aspect: string;
  size_in: [number, number];
  palette: string[];
  fonts: string[];
  font_sizes_pt: number[];
  images: number;
  tables: number;
  charts: number;
}
export interface OfficeExtract {
  kind: string;
  text: string;
  slides?: Slide[];
  sheets?: Sheet[];
  blocks?: Block[];
  svgs?: Array<string | null>;
  design?: DeckDesign; // pptx look & feel (colors, fonts, layout)
}

export interface ExtractSource {
  /** local path to the bytes (may be absent in the cloud when `s3` is set) */
  file: string;
  ext: string;
  /** same bytes in S3 — lets files past the 6MB invoke cap still extract */
  s3?: { bucket: string; key: string };
}

const TEXT_CAP = 400_000;
// base64 of ~4MB lands near the 6MB sync-invoke request cap
const INLINE_MAX = 4 * 1024 * 1024;

export function extractKindFor(ext: string): ExtractKind | null {
  return KIND_BY_EXT[ext.toLowerCase()] ?? null;
}

/** Legacy binary formats only markitdown can read — and markitdown needs Python. */
function legacyCloudError(ext: string): Error {
  const modern: Record<string, string> = { '.doc': '.docx', '.ppt': '.pptx', '.xls': '.xlsx' };
  const suggest = modern[ext] ? `save it as ${modern[ext]}` : 'convert it to PDF';
  return new Error(`${ext} files can't be read here — ${suggest} and upload again`);
}

async function viaOfficeLambda(kind: ExtractKind, src: ExtractSource): Promise<OfficeExtract> {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const client = new LambdaClient({ region: config.bedrock.region || process.env.AWS_REGION || 'us-east-1' });

  // null size = no local copy on this container, so S3 is the only way in
  const size = (() => {
    try {
      return statSync(src.file).size;
    } catch {
      return null;
    }
  })();
  const payload: Record<string, unknown> = { op: 'extract', kind };
  if (size !== null && size <= INLINE_MAX) {
    payload.file_b64 = readFileSync(src.file).toString('base64');
  } else if (src.s3) {
    payload.s3 = src.s3;
  } else if (size === null) {
    throw new Error('the file is no longer available to read — upload it again');
  } else {
    throw new Error(`file is too large to extract (${Math.round(size / 1e6)}MB) and has no S3 copy`);
  }

  const out = await client.send(
    new InvokeCommand({ FunctionName: 'atlasv2-office', Payload: Buffer.from(JSON.stringify(payload)) }),
  );
  const raw = Buffer.from(out.Payload ?? new Uint8Array()).toString('utf8');
  // an unhandled Python error comes back as an errorMessage envelope, not our shape
  if (out.FunctionError) throw new Error(`office function failed: ${raw.slice(0, 200)}`);
  return parseExtract(raw);
}

async function viaLocalPython(kind: ExtractKind, file: string): Promise<OfficeExtract> {
  const venv = path.join(repoRoot, 'runtimes/python/venv/bin/python');
  const script = path.join(repoRoot, 'scripts/office/extract_office.py');
  // the helper reports a handled failure as JSON on stdout AND exits non-zero,
  // so the reason lives on the thrown error — without this the caller would
  // surface execFile's "Command failed: <venv path> …", which tells a user
  // nothing and leaks absolute paths into the chat
  const stdout = await execFileAsync(venv, [script, kind, file], {
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  }).then(
    (r) => r.stdout,
    (err: Error & { stdout?: string }) => {
      if (err.stdout?.trim().startsWith('{')) return err.stdout;
      throw err;
    },
  );
  return parseExtract(stdout);
}

function parseExtract(raw: string): OfficeExtract {
  let r: OfficeExtract & { ok?: boolean; error?: string };
  try {
    r = JSON.parse(raw) as typeof r;
  } catch {
    throw new Error(`extractor returned unreadable output: ${raw.slice(0, 200)}`);
  }
  if (r.ok === false || !r.text) throw new Error(cleanError(r.error) ?? 'the file contained no readable text');
  return { ...r, text: r.text.slice(0, TEXT_CAP) };
}

/** python-pptx/openpyxl raise class-name-prefixed errors that mean nothing to a
 * user; translate the common one and strip any local paths from the rest. */
function cleanError(err: string | undefined): string | null {
  if (!err) return null;
  if (/PackageNotFoundError|not a zip file|BadZipFile/i.test(err)) {
    return 'the file is not a valid Office document (it may be corrupt or renamed from another format)';
  }
  return err.replace(/(\/[^\s:]+)+/g, '<path>').slice(0, 200);
}

/**
 * Extract a document's text + structure. Throws with a user-readable reason —
 * callers surface it rather than swallowing it, because a silent failure here
 * reads to the model as "the file is empty" and it invents an explanation.
 */
export async function extractOffice(src: ExtractSource): Promise<OfficeExtract> {
  const ext = src.ext.toLowerCase();
  const kind = extractKindFor(ext);
  const t0 = Date.now();
  const result = await (async () => {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      if (!kind) throw legacyCloudError(ext);
      return await viaOfficeLambda(kind, src);
    }
    if (kind) return await viaLocalPython(kind, src.file);
    // local legacy formats still go through markitdown
    const venv = path.join(repoRoot, 'runtimes/python/venv/bin/python');
    const { stdout } = await execFileAsync(venv, ['-m', 'markitdown', src.file], {
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { kind: ext.replace('.', ''), text: stdout.slice(0, TEXT_CAP) };
  })();
  logTo('app', `extracted ${ext} in ${Date.now() - t0}ms (${result.text.length} chars${result.slides ? `, ${result.slides.length} slides` : ''})`);
  return result;
}

export type RenderPdfResult = { ok: true; pdfPath: string } | { ok: false; status: number; error: string };

/**
 * pdf/pptx/docx/xlsx → a real PDF, cached alongside the source file
 * (`<file>.preview.pdf`, mtime-checked). Shared by artifact and
 * project-knowledge preview routes — one soffice conversion path, one cache
 * convention, instead of two copies that would drift.
 */
export async function renderOfficeToPdf(file: string, kind: string): Promise<RenderPdfResult> {
  if (kind === 'pdf') return { ok: true, pdfPath: file };
  if (!['pptx', 'docx', 'xlsx'].includes(kind)) {
    return { ok: false, status: 400, error: `no PDF rendering for kind ${kind}` };
  }
  const cached = `${file}.preview.pdf`;
  if (existsSync(cached) && statSync(cached).mtimeMs >= statSync(file).mtimeMs) {
    return { ok: true, pdfPath: cached };
  }
  const soffice = ['/opt/homebrew/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].find((p) =>
    existsSync(p),
  );
  if (!soffice) {
    return { ok: false, status: 404, error: 'soffice not present — falling back to text preview' };
  }
  try {
    const outDir = path.dirname(file);
    await execFileAsync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, file], { timeout: 120_000 });
    const produced = path.join(outDir, `${path.basename(file, path.extname(file))}.pdf`);
    if (!existsSync(produced)) throw new Error('soffice produced no PDF');
    const { renameSync } = await import('node:fs');
    renameSync(produced, cached);
    return { ok: true, pdfPath: cached };
  } catch (err) {
    return { ok: false, status: 500, error: `render failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
