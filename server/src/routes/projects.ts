import { Router } from 'express';
import { getDb, newId, now } from '../db/db.js';
import { memorySnapshot, upsertKv, deleteMemory } from '../memory/engine.js';

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
  // holistic memory: every new project gets its own (isolated) memory, on by default
  const mem = getDb().prepare("SELECT id, enabled_projects FROM plugin_installs WHERE connector_id = 'memory'").get() as
    | { id: string; enabled_projects: string }
    | undefined;
  if (mem) {
    const enabled = new Set(JSON.parse(mem.enabled_projects) as string[]);
    enabled.add(id);
    getDb().prepare('UPDATE plugin_installs SET enabled_projects = ? WHERE id = ?').run(JSON.stringify([...enabled]), mem.id);
  }
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

/* ---------- holistic memory (browse/edit) ----------
 * :id is a projectId or the literal 'user' for the cross-project user scope. */

projectsRouter.get('/:id/memory', (req, res) => {
  memorySnapshot(req.params.id)
    .then((snap) => res.json(snap))
    .catch((err: Error) => res.status(502).json({ error: `memory unavailable: ${err.message}` }));
});

projectsRouter.put('/:id/memory/kv', (req, res) => {
  const { key, value } = req.body as { key?: string; value?: string };
  if (!key || value === undefined) {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }
  upsertKv(req.params.id, key, value)
    .then(() => res.json({ ok: true }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

projectsRouter.post('/:id/memory/delete', (req, res) => {
  const { kind, ref } = req.body as { kind?: 'kv' | 'note' | 'fact'; ref?: Record<string, string> };
  if (!kind || !ref) {
    res.status(400).json({ error: 'kind and ref are required' });
    return;
  }
  deleteMemory(req.params.id, kind, ref)
    .then(() => res.json({ ok: true }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});
