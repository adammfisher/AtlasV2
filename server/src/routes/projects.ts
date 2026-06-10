import { Router } from 'express';
import { getDb, newId, now } from '../db/db.js';

export interface ProjectRow {
  id: string;
  name: string;
  instructions: string;
  created_at: number;
  settings: string;
}

function withStats(p: ProjectRow) {
  const db = getDb();
  const chats = (
    db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE project_id = ?').get(p.id) as {
      n: number;
    }
  ).n;
  // template libraries are post-v1 — artifact count stands in (PRD A47)
  const templates = (
    db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ?').get(p.id) as {
      n: number;
    }
  ).n;
  const installs = db
    .prepare('SELECT enabled_projects FROM plugin_installs')
    .all() as Array<{ enabled_projects: string }>;
  const plugins = installs.filter((r) =>
    (JSON.parse(r.enabled_projects) as string[]).includes(p.id),
  ).length;
  const shared = Boolean((JSON.parse(p.settings || '{}') as { shared?: boolean }).shared);
  return {
    id: p.id,
    name: p.name,
    instructions: p.instructions,
    created_at: p.created_at,
    chats,
    templates,
    plugins,
    shared,
  };
}

export const projectsRouter = Router();

projectsRouter.get('/', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT id, name, instructions, created_at, settings FROM projects ORDER BY created_at')
    .all() as ProjectRow[];
  res.json(rows.map(withStats));
});

projectsRouter.post('/', (req, res) => {
  const { name, instructions } = req.body as { name?: string; instructions?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const id = newId('p');
  getDb()
    .prepare('INSERT INTO projects (id, name, instructions, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name.trim(), instructions?.trim() ?? '', now());
  const row = getDb()
    .prepare('SELECT id, name, instructions, created_at, settings FROM projects WHERE id = ?')
    .get(id) as ProjectRow;
  res.status(201).json(withStats(row));
});

projectsRouter.patch('/:id', (req, res) => {
  const { name, instructions } = req.body as { name?: string; instructions?: string };
  const db = getDb();
  const existing = db
    .prepare('SELECT id, name, instructions, created_at, settings FROM projects WHERE id = ?')
    .get(req.params.id) as ProjectRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'project not found' });
    return;
  }
  db.prepare('UPDATE projects SET name = ?, instructions = ? WHERE id = ?').run(
    name ?? existing.name,
    instructions ?? existing.instructions,
    existing.id,
  );
  const row = db
    .prepare('SELECT id, name, instructions, created_at, settings FROM projects WHERE id = ?')
    .get(existing.id) as ProjectRow;
  res.json(withStats(row));
});
