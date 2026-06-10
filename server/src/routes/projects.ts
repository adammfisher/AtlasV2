import { Router } from 'express';
import { getDb, newId, now } from '../db/db.js';

export interface ProjectRow {
  id: string;
  name: string;
  instructions: string;
  created_at: number;
}

function withStats(p: ProjectRow) {
  const db = getDb();
  const chats = (
    db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE project_id = ?').get(p.id) as {
      n: number;
    }
  ).n;
  const artifacts = (
    db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ?').get(p.id) as {
      n: number;
    }
  ).n;
  const memBytes = (
    db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(value)),0) + COALESCE((SELECT SUM(LENGTH(props)) FROM mem_graph_nodes WHERE project_id = ?),0) AS n
         FROM mem_kv WHERE project_id = ?`,
      )
      .get(p.id, p.id) as { n: number }
  ).n;
  const memory =
    memBytes >= 1024 * 1024
      ? `${Math.round(memBytes / 1024 / 1024)} MB`
      : memBytes >= 1024
        ? `${Math.round(memBytes / 1024)} KB`
        : `${memBytes} B`;
  return { ...p, chats, artifacts, memory };
}

export const projectsRouter = Router();

projectsRouter.get('/', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT id, name, instructions, created_at FROM projects ORDER BY created_at')
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
    .prepare('SELECT id, name, instructions, created_at FROM projects WHERE id = ?')
    .get(id) as ProjectRow;
  res.status(201).json(withStats(row));
});

projectsRouter.patch('/:id', (req, res) => {
  const { name, instructions } = req.body as { name?: string; instructions?: string };
  const db = getDb();
  const existing = db
    .prepare('SELECT id, name, instructions, created_at FROM projects WHERE id = ?')
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
    .prepare('SELECT id, name, instructions, created_at FROM projects WHERE id = ?')
    .get(existing.id) as ProjectRow;
  res.json(withStats(row));
});
