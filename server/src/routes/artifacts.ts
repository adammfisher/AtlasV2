import { Router } from 'express';
import { statSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { getDb } from '../db/db.js';
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
  listProjections,
  LOCAL_KINDS,
  type LocalKind,
} from '../pipeline/projections.js';
import { latestPayload } from '../pipeline/artifacts.js';
import { logTo } from '../log.js';

const execFileAsync = promisify(execFile);

interface ArtifactRow {
  id: string;
  project_id: string;
  name: string;
  kind: string;
  current_version: number;
  created_at: number;
  project_name: string;
}

interface VersionRow {
  id: string;
  version: number;
  file_path: string | null;
  meta: string | null;
  validation: string | null;
  created_at: number;
}

const SELECT = `SELECT a.id, a.project_id, a.name, a.kind, a.current_version, a.created_at, p.name AS project_name
   FROM artifacts a JOIN projects p ON p.id = a.project_id`;

function summarize(a: ArtifactRow) {
  const latest = getDb()
    .prepare('SELECT meta FROM artifact_versions WHERE artifact_id = ? AND version = ?')
    .get(a.id, a.current_version) as { meta: string | null } | undefined;
  return {
    id: a.id,
    projectId: a.project_id,
    project: a.project_name,
    name: a.name,
    kind: a.kind,
    ver: a.current_version,
    meta: latest?.meta ?? '',
    state: a.kind === 'product' ? currentState(a.id) : null,
    created_at: a.created_at,
  };
}

function getArtifact(id: string): ArtifactRow | undefined {
  return getDb().prepare(`${SELECT} WHERE a.id = ?`).get(id) as ArtifactRow | undefined;
}

export const artifactsRouter = Router();

artifactsRouter.get('/', (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
  if (projectId) {
    const names = new Map(
      (getDb().prepare('SELECT id, name FROM projects').all() as Array<{ id: string; name: string }>).map(
        (p) => [p.id, p.name],
      ),
    );
    res.json(
      scopedArtifacts(projectId).map((a) =>
        summarize({ ...a, project_name: names.get(a.project_id) ?? '' }),
      ),
    );
    return;
  }
  const rows = getDb().prepare(`${SELECT} ORDER BY a.created_at DESC`).all() as ArtifactRow[];
  res.json(rows.map(summarize));
});

artifactsRouter.get('/:id', (req, res) => {
  const row = getArtifact(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'artifact not found' });
    return;
  }
  const versions = (
    getDb()
      .prepare(
        'SELECT id, version, file_path, meta, validation, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC',
      )
      .all(row.id) as VersionRow[]
  ).map((v) => ({
    version: v.version,
    meta: v.meta,
    validation: v.validation ? (JSON.parse(v.validation) as unknown[]) : [],
    hasFile: Boolean(v.file_path && existsSync(v.file_path)),
    created_at: v.created_at,
  }));

  const base = { ...summarize(row), versions };
  if (row.kind !== 'product') {
    res.json(base);
    return;
  }

  const timeline = getDb()
    .prepare('SELECT state, note, stamped_by, at_version, created_at FROM product_states WHERE artifact_id = ? ORDER BY created_at')
    .all(row.id);
  const payload = latestPayload(row.id);
  const state = currentState(row.id);
  const target = nextState(state);
  const unmet =
    target && payload
      ? transitionRules(payload.payload as Record<string, unknown>, hasBundleRow(row.id))[target]
      : [];
  res.json({
    ...base,
    state,
    timeline,
    promote: target ? { to: target, unmet } : null,
    projections: listProjections(row.id, row.current_version),
    payload: payload?.payload ?? null,
  });
});

artifactsRouter.get('/:id/versions/:v/download', async (req, res) => {
  const row = getArtifact(req.params.id);
  const version = getDb()
    .prepare('SELECT file_path FROM artifact_versions WHERE artifact_id = ? AND version = ?')
    .get(req.params.id, Number(req.params.v)) as { file_path: string | null } | undefined;
  if (!row || !version?.file_path || !existsSync(version.file_path)) {
    res.status(404).json({ error: 'no file for this version' });
    return;
  }
  const target = version.file_path;
  if (statSync(target).isDirectory()) {
    // multi-file kinds stream as zip (PRD §7)
    const zipPath = path.join(os.tmpdir(), `atlas-dl-${row.id}-v${req.params.v}.zip`);
    await execFileAsync('/usr/bin/zip', ['-r', '-q', '-FS', zipPath, '.'], { cwd: target });
    res.download(zipPath, `${row.name}-v${req.params.v}.zip`);
    return;
  }
  res.download(target, path.basename(target));
});

artifactsRouter.post('/:id/restore', (req, res) => {
  const { version } = req.body as { version?: number };
  const row = getArtifact(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'artifact not found' });
    return;
  }
  const exists = getDb()
    .prepare('SELECT version FROM artifact_versions WHERE artifact_id = ? AND version = ?')
    .get(row.id, version) as { version: number } | undefined;
  if (!exists) {
    res.status(400).json({ error: `version ${version} does not exist` });
    return;
  }
  getDb().prepare('UPDATE artifacts SET current_version = ? WHERE id = ?').run(exists.version, row.id);
  logTo('app', `artifact ${row.id} restored to v${exists.version}`);
  res.json({ ok: true, ver: exists.version });
});

/** raw file content for previews (md/mermaid/svg single files; react/site file map) */
artifactsRouter.get('/:id/versions/:v/content', (req, res) => {
  const row = getArtifact(req.params.id);
  const version = getDb()
    .prepare('SELECT file_path, payload FROM artifact_versions WHERE artifact_id = ? AND version = ?')
    .get(req.params.id, Number(req.params.v)) as
    | { file_path: string | null; payload: string | null }
    | undefined;
  if (!row || !version) {
    res.status(404).json({ error: 'version not found' });
    return;
  }
  if (row.kind === 'react' || row.kind === 'site') {
    const payload = version.payload ? (JSON.parse(version.payload) as Record<string, unknown>) : {};
    res.json({ kind: row.kind, files: payload.files ?? {}, entry: payload.entry ?? '/index.html' });
    return;
  }
  if (version.file_path && existsSync(version.file_path) && !statSync(version.file_path).isDirectory()) {
    res.json({ kind: row.kind, source: readFileSync(version.file_path, 'utf8') });
    return;
  }
  res.status(404).json({ error: 'no previewable content' });
});

/** extraction-based text preview for office kinds (markitdown, labeled "text preview" — PRD §7) */
artifactsRouter.get('/:id/versions/:v/preview', async (req, res) => {
  const row = getArtifact(req.params.id);
  const version = getDb()
    .prepare('SELECT file_path FROM artifact_versions WHERE artifact_id = ? AND version = ?')
    .get(req.params.id, Number(req.params.v)) as { file_path: string | null } | undefined;
  if (!row || !version?.file_path || !existsSync(version.file_path)) {
    res.status(404).json({ error: 'no file for this version' });
    return;
  }
  if (statSync(version.file_path).isDirectory()) {
    res.status(400).json({ error: 'directory artifacts preview in the sandbox' });
    return;
  }
  try {
    const { repoRoot } = await import('../config.js');
    const { stdout } = await execFileAsync(
      path.join(repoRoot, 'runtimes/python/venv/bin/python'),
      ['-m', 'markitdown', version.file_path],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    res.json({ kind: row.kind, label: 'text preview', text: stdout.slice(0, 20_000) });
  } catch (err) {
    res.status(500).json({ error: `markitdown extraction failed: ${err instanceof Error ? err.message : err}` });
  }
});

/* ---------- Amendment 1: state machine + projections + bundle ---------- */

artifactsRouter.post('/:id/state', (req, res) => {
  const { to, note } = req.body as { to?: string; note?: string };
  const row = getArtifact(req.params.id);
  if (!row || row.kind !== 'product') {
    res.status(404).json({ error: 'product artifact not found' });
    return;
  }
  const state = currentState(row.id);
  const target = nextState(state);
  if (!to || to !== target) {
    res.status(400).json({ error: `only forward transition to '${target ?? 'none'}' is allowed from '${state}'` });
    return;
  }
  if (to === 'operating' && !note?.trim()) {
    res.status(400).json({ error: 'operating requires a note (manual stamp)' });
    return;
  }
  const payload = latestPayload(row.id);
  const unmet = payload
    ? transitionRules(payload.payload as Record<string, unknown>, hasBundleRow(row.id))[to as ProductState]
    : ['no payload'];
  if (unmet.length > 0) {
    res.status(400).json({ error: `unmet requirements: ${unmet.join(' · ')}` });
    return;
  }
  // outstanding ambers carried into the stamp note verbatim (A5)
  const latestValidation = getDb()
    .prepare('SELECT validation FROM artifact_versions WHERE artifact_id = ? AND version = ?')
    .get(row.id, row.current_version) as { validation: string | null } | undefined;
  const ambers = latestValidation?.validation
    ? (JSON.parse(latestValidation.validation) as Array<{ state: string; label: string }>)
        .filter((c) => c.state === 'warn')
        .map((c) => c.label)
    : [];
  stampState(row.id, to as ProductState, note ?? '', row.current_version, ambers);
  logTo('app', `product ${row.id} promoted to ${to} at v${row.current_version}`);
  res.json({ ok: true, state: to, ambers });
});

artifactsRouter.get('/:id/projections', (req, res) => {
  const row = getArtifact(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'artifact not found' });
    return;
  }
  res.json(listProjections(row.id, row.current_version));
});

artifactsRouter.post('/:id/projections', async (req, res) => {
  const { kind } = req.body as { kind?: string };
  const row = getArtifact(req.params.id);
  if (!row || row.kind !== 'product') {
    res.status(404).json({ error: 'product artifact not found' });
    return;
  }
  if (!kind || !([...LOCAL_KINDS, 'bundle'] as string[]).includes(kind)) {
    if (kind === 'confluence_page' || kind === 'jira_epics') {
      res.status(501).json({ error: `${kind} pushes ship in Stage 4 — connect the connector to push.` });
      return;
    }
    res.status(400).json({ error: `unknown projection kind: ${kind}` });
    return;
  }
  try {
    const result = await generateProjection(
      row.project_id,
      row.id,
      row.name,
      kind as LocalKind | 'bundle',
      currentState(row.id),
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

artifactsRouter.get('/:id/bundle', async (req, res) => {
  const row = getArtifact(req.params.id);
  if (!row || row.kind !== 'product') {
    res.status(404).json({ error: 'product artifact not found' });
    return;
  }
  const state = currentState(row.id);
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
});

artifactsRouter.get('/:id/projections/:pid/download', (req, res) => {
  const projection = getDb()
    .prepare('SELECT output_ref FROM projections WHERE id = ? AND artifact_id = ?')
    .get(req.params.pid, req.params.id) as { output_ref: string | null } | undefined;
  if (!projection?.output_ref || !existsSync(projection.output_ref)) {
    res.status(404).json({ error: 'projection output not found' });
    return;
  }
  if (statSync(projection.output_ref).isDirectory()) {
    res.status(400).json({ error: 'directory projections preview in the sandbox' });
    return;
  }
  res.download(projection.output_ref, path.basename(projection.output_ref));
});
