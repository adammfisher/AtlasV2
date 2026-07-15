import { Router } from 'express';
import { statSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromIni } from '@aws-sdk/credential-providers';
import { bedrockSettings } from '../providers/bedrock.js';
import {
  listProjects,
  getProject,
  listArtifacts,
  getArtifactRow,
  setArtifactCurrentVersion,
  listVersions,
  getVersion,
  listProductStates,
  getProjection,
} from '../db/appdb.js';
import { scopedArtifacts } from '../db/scoped.js';
import {
  currentState,
  nextState,
  transitionRules,
  stampState,
  hasBundleRow,
  PRODUCT_STATES,
  type ProductState,
} from '../pipeline/product.js';
import {
  generateProjection,
  generatePushProjection,
  listProjections,
  LOCAL_KINDS,
  type LocalKind,
} from '../pipeline/projections.js';
import { latestPayload } from '../pipeline/artifacts.js';
import { hydrateArtifactPath } from '../storage/artifacts-s3.js';
import { extractOffice } from '../office/extract.js';
import { logTo } from '../log.js';

const execFileAsync = promisify(execFile);

/** Zip a version directory in-process — the Lambda runtime has no /usr/bin/zip. */
async function zipDir(dir: string): Promise<Buffer> {
  const { buildZip } = await import('../lib/zip.js');
  const { readdirSync, readFileSync: rf } = await import('node:fs');
  const entries: Array<{ name: string; data: Buffer }> = [];
  const walk = (d: string, prefix: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, `${prefix}${e.name}/`);
      else entries.push({ name: `${prefix}${e.name}`, data: rf(full) });
    }
  };
  walk(dir, '');
  return buildZip(entries);
}


interface ArtifactRow {
  id: string;
  project_id: string;
  conv_id?: string;
  name: string;
  kind: string;
  current_version: number;
  created_at: number;
  project_name: string;
}

async function summarize(a: ArtifactRow) {
  const latest = await getVersion(a.id, a.current_version);
  return {
    id: a.id,
    projectId: a.project_id,
    convId: a.conv_id ?? null,
    project: a.project_name,
    name: a.name,
    kind: a.kind,
    ver: a.current_version,
    meta: latest?.meta ?? '',
    state: a.kind === 'product' ? await currentState(a.id) : null,
    created_at: a.created_at,
  };
}

async function getArtifact(id: string): Promise<ArtifactRow | undefined> {
  const row = await getArtifactRow(id);
  if (!row) return undefined;
  const project = await getProject(row.project_id);
  return { ...row, project_name: project?.name ?? '' };
}

export const artifactsRouter = Router();

artifactsRouter.get('/', (req, res) => {
  void (async () => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
    const names = new Map((await listProjects()).map((p) => [p.id, p.name]));
    const rows = projectId ? await scopedArtifacts(projectId) : await listArtifacts(); // created_at DESC
    res.json(
      await Promise.all(
        rows.map((a) => summarize({ ...a, project_name: names.get(a.project_id) ?? '' })),
      ),
    );
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

artifactsRouter.get('/:id', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }
    const versions = (await listVersions(row.id))
      .slice()
      .sort((a, b) => b.version - a.version)
      .map((v) => ({
        version: v.version,
        meta: v.meta,
        validation: v.validation ? (JSON.parse(v.validation) as unknown[]) : [],
        hasFile: Boolean(v.file_path && existsSync(v.file_path)),
        created_at: v.created_at,
      }));

    const base = { ...(await summarize(row)), versions };
    if (row.kind !== 'product') {
      res.json(base);
      return;
    }

    const timeline = (await listProductStates(row.id)).map((s) => ({
      state: s.state,
      note: s.note,
      stamped_by: s.stamped_by,
      at_version: s.at_version,
      created_at: s.created_at,
    }));
    const payload = await latestPayload(row.id);
    const state = await currentState(row.id);
    const target = nextState(state);
    const unmet =
      target && payload
        ? transitionRules(payload.payload as Record<string, unknown>, await hasBundleRow(row.id))[target]
        : [];
    res.json({
      ...base,
      state,
      timeline,
      promote: target ? { to: target, unmet } : null,
      projections: await listProjections(row.id, row.current_version),
      payload: payload?.payload ?? null,
    });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

artifactsRouter.get('/:id/versions/:v/download', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    const version = await getVersion(req.params.id, Number(req.params.v));
    if (version?.file_path) await hydrateArtifactPath(version.file_path);
    if (!row || !version?.file_path || !existsSync(version.file_path)) {
      res.status(404).json({ error: 'no file for this version' });
      return;
    }
    const target = version.file_path;
    if (statSync(target).isDirectory()) {
      // multi-file kinds stream as zip (PRD §7)
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${row.name}-v${req.params.v}.zip"`);
      res.send(await zipDir(target));
      return;
    }
    // express maps .mmd to a karaoke MIME type; pin sane types for our text kinds
    const TEXT_TYPES: Record<string, string> = {
      '.mmd': 'text/plain; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    };
    const ext = path.extname(target).toLowerCase();
    if (TEXT_TYPES[ext]) res.type(TEXT_TYPES[ext]);
    res.download(target, path.basename(target));
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Share (claude.ai publish parity): upload the version file to S3 and return
 * a 7-day presigned link anyone can download. Multi-file kinds share as zip. */
artifactsRouter.post('/:id/versions/:v/share', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    const version = await getVersion(req.params.id, Number(req.params.v));
    if (version?.file_path) await hydrateArtifactPath(version.file_path);
    if (!row || !version?.file_path || !existsSync(version.file_path)) {
      res.status(404).json({ error: 'no file for this version' });
      return;
    }
    try {
      let target = version.file_path;
      let filename = path.basename(target);
      if (statSync(target).isDirectory()) {
        const zipPath = path.join(os.tmpdir(), `atlas-share-${row.id}-v${req.params.v}.zip`);
        const { writeFileSync: wf } = await import('node:fs');
        wf(zipPath, await zipDir(target));
        target = zipPath;
        filename = `${row.name}-v${req.params.v}.zip`;
      }
      const s = bedrockSettings();
      const s3 = new S3Client({ region: s.region || 'us-east-1', ...(process.env.AWS_LAMBDA_FUNCTION_NAME ? {} : { credentials: fromIni({ profile: s.profile || 'default' }) }) });
      const bucket = 'atlasv2-uploads-683032473658';
      const key = `shares/${row.id}-v${req.params.v}/${filename}`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(target) }));
      // C11: kinds a browser can RENDER open as a viewable page (claude.ai
      // share parity); office binaries stay downloads — nothing renders them
      const inlineTypes: Record<string, string> = {
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.html': 'text/html; charset=utf-8',
        '.md': 'text/plain; charset=utf-8',
        '.mmd': 'text/plain; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
        '.png': 'image/png',
        '.json': 'application/json',
      };
      const ext = path.extname(filename).toLowerCase();
      const inline = inlineTypes[ext];
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: inline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`,
          ...(inline ? { ResponseContentType: inline } : {}),
        }),
        { expiresIn: 7 * 86_400 },
      );
      logTo('app', `artifact shared: ${row.id} v${req.params.v} → s3 presigned (7d)`);
      res.json({ url, expiresDays: 7 });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

artifactsRouter.post('/:id/restore', (req, res) => {
  void (async () => {
    const { version } = req.body as { version?: number };
    const row = await getArtifact(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }
    const exists = typeof version === 'number' ? await getVersion(row.id, version) : undefined;
    if (!exists) {
      res.status(400).json({ error: `version ${version} does not exist` });
      return;
    }
    await setArtifactCurrentVersion(row.id, exists.version);
    logTo('app', `artifact ${row.id} restored to v${exists.version}`);
    res.json({ ok: true, ver: exists.version });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** raw file content for previews (md/mermaid/svg single files; react/site file map) */
artifactsRouter.get('/:id/versions/:v/content', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    const version = await getVersion(req.params.id, Number(req.params.v));
    if (!row || !version) {
      res.status(404).json({ error: 'version not found' });
      return;
    }
    if (row.kind === 'react' || row.kind === 'site') {
      const payload = version.payload ? (JSON.parse(version.payload) as Record<string, unknown>) : {};
      res.json({ kind: row.kind, files: payload.files ?? {}, entry: payload.entry ?? '/index.html' });
      return;
    }
    if (version.file_path) await hydrateArtifactPath(version.file_path);
    if (version.file_path && existsSync(version.file_path) && !statSync(version.file_path).isDirectory()) {
      res.json({ kind: row.kind, source: readFileSync(version.file_path, 'utf8') });
      return;
    }
    res.status(404).json({ error: 'no previewable content' });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/**
 * Real document preview: pdf streams inline; pptx/docx/xlsx convert via soffice
 * (cached per version) and stream the PDF inline. 404s when soffice is absent —
 * the client falls back to the markitdown text preview (PRD §7 degradation).
 */
artifactsRouter.get('/:id/versions/:v/render.pdf', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    const version = await getVersion(req.params.id, Number(req.params.v));
    if (version?.file_path) await hydrateArtifactPath(version.file_path);
    if (!row || !version?.file_path || !existsSync(version.file_path) || statSync(version.file_path).isDirectory()) {
      res.status(404).json({ error: 'no renderable file for this version' });
      return;
    }
    const file = version.file_path;
    // filename on the inline disposition: saves from the embedded PDF viewer
    // otherwise land as UUID-named files with no extension
    const pdfName = `${path.basename(file, path.extname(file))}.pdf`;
    const inline = (pdf: string) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${pdfName.replace(/"/g, '')}"`);
      res.sendFile(pdf);
    };
    if (row.kind === 'pdf') {
      inline(file);
      return;
    }
    if (!['pptx', 'docx', 'xlsx'].includes(row.kind)) {
      res.status(400).json({ error: `no PDF rendering for kind ${row.kind}` });
      return;
    }
    const cached = path.join(path.dirname(file), `${path.basename(file)}.preview.pdf`);
    if (existsSync(cached) && statSync(cached).mtimeMs >= statSync(file).mtimeMs) {
      inline(cached);
      return;
    }
    const soffice = ['/opt/homebrew/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].find((p) =>
      existsSync(p),
    );
    if (!soffice) {
      res.status(404).json({ error: 'soffice not present — falling back to text preview' });
      return;
    }
    try {
      const outDir = path.dirname(file);
      await execFileAsync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, file], {
        timeout: 120_000,
      });
      const produced = path.join(outDir, `${path.basename(file, path.extname(file))}.pdf`);
      if (!existsSync(produced)) throw new Error('soffice produced no PDF');
      const { renameSync } = await import('node:fs');
      renameSync(produced, cached);
      inline(cached);
    } catch (err) {
      res.status(500).json({ error: `render failed: ${err instanceof Error ? err.message : err}` });
    }
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** extraction-based text preview for office kinds (markitdown, labeled "text preview" — PRD §7) */
artifactsRouter.get('/:id/versions/:v/preview', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    const version = await getVersion(req.params.id, Number(req.params.v));
    if (version?.file_path) await hydrateArtifactPath(version.file_path);
    if (!row || !version?.file_path || !existsSync(version.file_path)) {
      res.status(404).json({ error: 'no file for this version' });
      return;
    }
    if (statSync(version.file_path).isDirectory()) {
      res.status(400).json({ error: 'directory artifacts preview in the sandbox' });
      return;
    }
    try {
      const r = await extractOffice({ file: version.file_path, ext: `.${row.kind}` });
      res.json({
        kind: row.kind,
        label: 'preview',
        text: r.text.slice(0, 20_000),
        svgs: r.svgs,
        slides: r.slides,
        sheets: r.sheets,
        blocks: r.blocks,
      });
    } catch (err) {
      res.status(500).json({ error: `extraction failed: ${err instanceof Error ? err.message : err}` });
    }
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/* ---------- Amendment 1: state machine + projections + bundle ---------- */

artifactsRouter.post('/:id/state', (req, res) => {
  void (async () => {
    const { to, note } = req.body as { to?: string; note?: string };
    const row = await getArtifact(req.params.id);
    if (!row || row.kind !== 'product') {
      res.status(404).json({ error: 'product artifact not found' });
      return;
    }
    const state = await currentState(row.id);
    const target = nextState(state);
    if (!to || to !== target) {
      res.status(400).json({ error: `only forward transition to '${target ?? 'none'}' is allowed from '${state}'` });
      return;
    }
    if (to === 'operating' && !note?.trim()) {
      res.status(400).json({ error: 'operating requires a note (manual stamp)' });
      return;
    }
    const payload = await latestPayload(row.id);
    const unmet = payload
      ? transitionRules(payload.payload as Record<string, unknown>, await hasBundleRow(row.id))[to as ProductState]
      : ['no payload'];
    if (unmet.length > 0) {
      res.status(400).json({ error: `unmet requirements: ${unmet.join(' · ')}` });
      return;
    }
    // outstanding ambers carried into the stamp note verbatim (A5)
    const latestValidation = await getVersion(row.id, row.current_version);
    const ambers = latestValidation?.validation
      ? (JSON.parse(latestValidation.validation) as Array<{ state: string; label: string }>)
          .filter((c) => c.state === 'warn')
          .map((c) => c.label)
      : [];
    await stampState(row.id, to as ProductState, note ?? '', row.current_version, ambers);
    logTo('app', `product ${row.id} promoted to ${to} at v${row.current_version}`);
    res.json({ ok: true, state: to, ambers });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

artifactsRouter.get('/:id/projections', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }
    res.json(await listProjections(row.id, row.current_version));
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

artifactsRouter.post('/:id/projections', (req, res) => {
  void (async () => {
    const { kind } = req.body as { kind?: string };
    const row = await getArtifact(req.params.id);
    if (!row || row.kind !== 'product') {
      res.status(404).json({ error: 'product artifact not found' });
      return;
    }
    if (kind === 'confluence_page' || kind === 'jira_epics') {
      try {
        const result = await generatePushProjection(row.project_id, row.id, row.name, kind);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (!kind || !([...LOCAL_KINDS, 'bundle'] as string[]).includes(kind)) {
      res.status(400).json({ error: `unknown projection kind: ${kind}` });
      return;
    }
    try {
      const result = await generateProjection(
        row.project_id,
        row.id,
        row.name,
        kind as LocalKind | 'bundle',
        await currentState(row.id),
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

artifactsRouter.get('/:id/bundle', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    if (!row || row.kind !== 'product') {
      res.status(404).json({ error: 'product artifact not found' });
      return;
    }
    const state = await currentState(row.id);
    const order = PRODUCT_STATES.indexOf(state);
    if (order < PRODUCT_STATES.indexOf('specified')) {
      res.status(400).json({ error: `bundle export unlocks at 'specified' — current state is '${state}'` });
      return;
    }
    try {
      const result = await generateProjection(row.project_id, row.id, row.name, 'bundle', state);
      res.download(result.outputRef, path.basename(result.outputRef));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

artifactsRouter.get('/:id/projections/:pid/download', (req, res) => {
  void (async () => {
    const projection = await getProjection(req.params.id, req.params.pid);
    if (!projection?.output_ref || !existsSync(projection.output_ref)) {
      res.status(404).json({ error: 'projection output not found' });
      return;
    }
    if (statSync(projection.output_ref).isDirectory()) {
      res.status(400).json({ error: 'directory projections preview in the sandbox' });
      return;
    }
    res.download(projection.output_ref, path.basename(projection.output_ref));
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Reveal the artifact file in Finder — the always-works path for local files. */
artifactsRouter.post('/:id/versions/:v/reveal', (req, res) => {
  void (async () => {
    const row = await getArtifact(req.params.id);
    const version = row ? await getVersion(row.id, Number(req.params.v)) : undefined;
    if (!version?.file_path) {
      res.status(404).json({ error: 'no file for this version' });
      return;
    }
    execFile('/usr/bin/open', ['-R', version.file_path], (err) =>
      err ? res.status(500).json({ error: err.message }) : res.json({ ok: true }),
    );
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});
