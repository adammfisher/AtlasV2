import { Router } from 'express';
import { getDb, getSetting, newId, now } from '../db/db.js';
import { scopedConversations, type ConversationRow } from '../db/scoped.js';

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  kind: string;
  payload: string;
  created_at: number;
}

export const conversationsRouter = Router();

conversationsRouter.get('/', (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
  // Sidebar recents span all projects by design (PRD §7); scoped reads go through
  // the isolation helpers.
  const rows = projectId
    ? scopedConversations(projectId)
    : (getDb()
        .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
        .all() as ConversationRow[]);
  res.json(rows.map((r) => ({ ...r, projectId: r.project_id })));
});

conversationsRouter.post('/', (req, res) => {
  const body = req.body as { projectId?: string };
  const projectId = body.projectId ?? getSetting('activeProjectId');
  if (!projectId) {
    res.status(400).json({ error: 'no active project' });
    return;
  }
  const id = newId('c');
  const t = now();
  getDb()
    .prepare(
      'INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, projectId, 'New chat', t, t);
  res.status(201).json({ id, projectId, title: 'New chat', created_at: t, updated_at: t });
});

conversationsRouter.get('/:id', (req, res) => {
  const db = getDb();
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as
    | ConversationRow
    | undefined;
  if (!conv) {
    res.status(404).json({ error: 'conversation not found' });
    return;
  }
  const messages = (
    db
      .prepare(
        'SELECT id, role, kind, payload, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at',
      )
      .all(conv.id) as MessageRow[]
  ).map((m) => ({
    id: m.id,
    role: m.role,
    kind: m.kind,
    ...(JSON.parse(m.payload) as Record<string, unknown>),
  }));
  res.json({ ...conv, projectId: conv.project_id, messages });
});
