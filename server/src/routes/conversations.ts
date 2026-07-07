import { Router } from 'express';
import { setRemember, rememberEnabled } from '../memory/engine.js';
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

/** Rename (claude.ai parity). */
conversationsRouter.patch('/:id', (req, res) => {
  const { title } = req.body as { title?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  getDb().prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title.trim().slice(0, 120), now(), req.params.id);
  res.json({ ok: true });
});

/** Search titles + message content; returns matching conversations. */
conversationsRouter.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const like = `%${q}%`;
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT c.* FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.title LIKE ? OR m.payload LIKE ?
       ORDER BY c.updated_at DESC LIMIT 30`,
    )
    .all(like, like) as ConversationRow[];
  res.json(rows.map((r) => ({ ...r, projectId: r.project_id })));
});

/** Delete a message and everything after it (edit/regenerate support).
 * inclusive=false keeps the anchor message (retry: drop trailing responses). */
conversationsRouter.post('/:id/truncate', (req, res) => {
  const { messageId, inclusive } = req.body as { messageId?: string; inclusive?: boolean };
  const db = getDb();
  const anchor = db
    .prepare('SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, req.params.id) as { created_at: number } | undefined;
  if (!anchor) {
    res.status(404).json({ error: 'message not found' });
    return;
  }
  const del = inclusive
    ? db.prepare('DELETE FROM messages WHERE conversation_id = ? AND created_at >= ?').run(req.params.id, anchor.created_at)
    : db.prepare('DELETE FROM messages WHERE conversation_id = ? AND created_at > ?').run(req.params.id, anchor.created_at);
  res.json({ ok: true, deleted: del.changes });
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

conversationsRouter.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
  const out = db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deleted: out.changes });
});

/** Bulk delete (sidebar select-all flow). Artifacts are kept — they live in the gallery. */
conversationsRouter.post('/delete', (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids[] is required' });
    return;
  }
  const db = getDb();
  const delMsgs = db.prepare('DELETE FROM messages WHERE conversation_id = ?');
  const delConv = db.prepare('DELETE FROM conversations WHERE id = ?');
  let deleted = 0;
  const run = db.transaction((list: string[]) => {
    for (const id of list) {
      delMsgs.run(id);
      deleted += delConv.run(id).changes;
    }
  });
  run(ids);
  res.json({ ok: true, deleted });
});

/** Per-conversation "remember this chat" toggle (memory capture + recall). */
conversationsRouter.post('/:id/remember', (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled is required' });
    return;
  }
  setRemember(req.params.id, enabled);
  res.json({ ok: true, remember: enabled });
});

conversationsRouter.get('/:id/remember', (req, res) => {
  res.json({ remember: rememberEnabled(req.params.id) });
});
