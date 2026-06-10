import { Router } from 'express';
import { getDb } from '../db/db.js';

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

const SELECT =
  `SELECT a.id, a.project_id, a.name, a.kind, a.current_version, a.created_at, p.name AS project_name
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
    created_at: a.created_at,
  };
}

export const artifactsRouter = Router();

artifactsRouter.get('/', (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
  // Gallery spans projects when unscoped (mockup shows the project label per card).
  const rows = projectId
    ? (getDb().prepare(`${SELECT} WHERE a.project_id = ? ORDER BY a.created_at DESC`).all(projectId) as ArtifactRow[])
    : (getDb().prepare(`${SELECT} ORDER BY a.created_at DESC`).all() as ArtifactRow[]);
  res.json(rows.map(summarize));
});

artifactsRouter.get('/:id', (req, res) => {
  const row = getDb().prepare(`${SELECT} WHERE a.id = ?`).get(req.params.id) as
    | ArtifactRow
    | undefined;
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
    validation: v.validation ? (JSON.parse(v.validation) as Array<[string, number]>) : [],
    hasFile: Boolean(v.file_path),
    created_at: v.created_at,
  }));
  res.json({ ...summarize(row), versions });
});

const stage3 = { error: 'Artifact files ship in Stage 3 — seed artifacts are fixtures for now.' };
artifactsRouter.get('/:id/versions/:v/download', (_req, res) => res.status(501).json(stage3));
artifactsRouter.post('/:id/restore', (_req, res) => res.status(501).json(stage3));
