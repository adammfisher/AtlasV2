import { Router } from 'express';
import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  newId,
  now,
  listProjects,
  getProject,
  putProject,
  listConversations,
  listArtifacts,
  listInstalls,
  putInstall,
  type ProjectRow,
} from '../db/appdb.js';
import {
  memorySnapshot,
  upsertKv,
  deleteMemory,
  consolidate,
  extract,
  recallDebug,
  cancelPending,
} from '../memory/engine.js';
import { wipeScope, listTombstones } from '../memory/store.js';

async function withStats(p: ProjectRow) {
  const [convs, arts, installs] = await Promise.all([listConversations(p.id), listArtifacts([p.id]), listInstalls()]);
  const plugins = installs.filter((r) => (JSON.parse(r.enabled_projects) as string[]).includes(p.id)).length;
  const shared = Boolean((JSON.parse(p.settings || '{}') as { shared?: boolean }).shared);
  return {
    id: p.id,
    name: p.name,
    instructions: p.instructions,
    created_at: p.created_at,
    chats: convs.length,
    // template libraries are post-v1 — artifact count stands in (PRD A47)
    templates: arts.length,
    plugins,
    shared,
  };
}

export const projectsRouter = Router();

projectsRouter.get('/', (_req, res) => {
  listProjects()
    .then((rows) => Promise.all(rows.map(withStats)))
    .then((out) => res.json(out))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

projectsRouter.post('/', (req, res) => {
  const { name, instructions } = req.body as { name?: string; instructions?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  void (async () => {
    const id = newId('p');
    const row: ProjectRow = { id, name: name.trim(), instructions: instructions?.trim() ?? '', settings: '{}', created_at: now() };
    await putProject(row);
    // holistic memory: every new project gets its own (isolated) memory, on by default
    const mem = (await listInstalls()).find((i) => i.connector_id === 'memory' || i.connector_id === 'atlas-memory');
    if (mem) {
      const enabled = new Set(JSON.parse(mem.enabled_projects) as string[]);
      enabled.add(id);
      await putInstall({ ...mem, enabled_projects: JSON.stringify([...enabled]) });
    }
    res.status(201).json(await withStats(row));
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

projectsRouter.patch('/:id', (req, res) => {
  const { name, instructions } = req.body as { name?: string; instructions?: string };
  void (async () => {
    const existing = await getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'project not found' });
      return;
    }
    const row: ProjectRow = {
      ...existing,
      name: name ?? existing.name,
      instructions: instructions ?? existing.instructions,
    };
    await putProject(row);
    res.json(await withStats(row));
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
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

projectsRouter.post('/:id/memory/consolidate', (req, res) => {
  consolidate(req.params.id)
    .then((text) => res.json({ ok: true, profile: text }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Run a conversation's extraction immediately (eval harness / debugging). */
projectsRouter.post('/:id/memory/extract-now', (req, res) => {
  const { convId } = req.body as { convId?: string };
  if (!convId) {
    res.status(400).json({ error: 'convId is required' });
    return;
  }
  extract(convId, req.params.id)
    .then(() => res.json({ ok: true }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Observability: the exact block a query would inject, with per-hit scores. */
projectsRouter.get('/:id/memory/recall-preview', (req, res) => {
  recallDebug(req.params.id, String(req.query.q ?? ''))
    .then((debug) => res.json(debug))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Full JSON export of a scope, tombstone audit included. */
projectsRouter.get('/:id/memory/export', (req, res) => {
  Promise.all([memorySnapshot(req.params.id), listTombstones(req.params.id)])
    .then(([snap, tombstones]) => res.json({ ...snap, tombstones }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/* ---------- project knowledge (persistent documents, claude.ai parity) ---- */

projectsRouter.get('/:id/knowledge', (req, res) => {
  import('../memory/knowledge.js')
    .then(({ listKnowledge }) => listKnowledge(req.params.id))
    .then((rows) => res.json(rows))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

projectsRouter.post('/:id/knowledge/:kid/delete', (req, res) => {
  import('../memory/knowledge.js')
    .then(({ removeKnowledge }) => removeKnowledge(req.params.id, req.params.kid))
    .then(() => res.json({ ok: true }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

projectsRouter.get('/:id/knowledge/:kid/download', (req, res) => {
  void (async () => {
    const { knowledgeSource, knowledgeBucket, knowledgeS3 } = await import('../memory/knowledge.js');
    const hit = await knowledgeSource(req.params.id, req.params.kid);
    if (!hit) {
      res.status(404).json({ error: 'knowledge file not found' });
      return;
    }
    if (hit.file) {
      res.download(hit.file, hit.name);
      return;
    }
    const out = await knowledgeS3().send(new GetObjectCommand({ Bucket: knowledgeBucket(), Key: hit.s3Key! }));
    res.setHeader('Content-Disposition', `attachment; filename="${hit.name}"`);
    (out.Body as Readable).pipe(res);
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Irreversible scope wipe (items + vector index + queued extractions). */
projectsRouter.post('/:id/memory/wipe', (req, res) => {
  cancelPending(req.params.id);
  wipeScope(req.params.id)
    .then((r) => res.json({ ok: true, ...r }))
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
