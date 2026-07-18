import { Router } from 'express';
import { setRemember, rememberEnabled } from '../memory/engine.js';
import {
  getSetting,
  setSetting,
  newId,
  now,
  listConversations,
  getConversation,
  putConversation,
  touchConversation,
  deleteConversation,
  listMessages,
  findMessage,
  truncateMessages,
} from '../db/appdb.js';

export const conversationsRouter = Router();

conversationsRouter.get('/', (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  // Sidebar recents span all projects by design (PRD §7)
  listConversations(projectId)
    .then((rows) => res.json(rows.map((r) => ({ ...r, projectId: r.project_id }))))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Unscoped chats live in a neutral "General" project (claude.ai parity: a
 * sidebar New Chat must NOT inherit whatever project happens to be active —
 * that leaked project instructions and memory scope into general chats). */
async function ensureGeneralProject(): Promise<string> {
  const { getProject, putProject } = await import('../db/appdb.js');
  if (!(await getProject('p_general'))) {
    await putProject({ id: 'p_general', name: 'General', instructions: '', settings: '{}', created_at: now() });
    // a fresh install's very first chat can predate ensureBundledInstalled()
    // ever seeing this project id — enable the bundled connectors right now
    // rather than leaving them stuck until some later boot catches up
    const { enableBundledForProject } = await import('../mcp/manager.js');
    await enableBundledForProject('p_general');
  }
  return 'p_general';
}

conversationsRouter.post('/', (req, res) => {
  void (async () => {
  const body = req.body as { projectId?: string; incognito?: boolean };
  // explicit projectId = a chat started inside that project's workspace;
  // everything else is a general chat
  const projectId = body.projectId ?? (await ensureGeneralProject());
  const id = newId('c');
  const t = now();
  const incognito = body.incognito === true;
  await putConversation({ id, project_id: projectId, title: incognito ? 'Incognito chat' : 'New chat', created_at: t, updated_at: t, ...(incognito ? { incognito: true } : {}) });
  if (incognito) setRemember(id, false); // no memory capture, no recall
  res.status(201).json({ id, projectId, title: incognito ? 'Incognito chat' : 'New chat', created_at: t, updated_at: t, incognito });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Rename (claude.ai parity). */
conversationsRouter.patch('/:id', (req, res) => {
  const { title } = req.body as { title?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  touchConversation(req.params.id, { title: title.trim().slice(0, 120), updated_at: now() })
    .then(() => res.json({ ok: true }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Search titles + message content; returns matching conversations. */
conversationsRouter.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (!q) {
    res.json([]);
    return;
  }
  void (async () => {
    const convs = await listConversations();
    const hits: typeof convs = [];
    for (const c of convs) {
      if (c.title.toLowerCase().includes(q)) {
        hits.push(c);
      } else {
        const msgs = await listMessages(c.id);
        if (msgs.some((m) => m.payload.toLowerCase().includes(q))) hits.push(c);
      }
      if (hits.length >= 30) break;
    }
    res.json(hits.map((r) => ({ ...r, projectId: r.project_id })));
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Delete a message and everything after it (edit/regenerate support). */
/** V8: export ALL conversations as a zip of markdown files (+ manifest.json). */
conversationsRouter.get('/export.zip', (_req, res) => {
  void (async () => {
    // in-process zip — the Lambda runtime has no /usr/bin/zip (found by a
    // deployed probe: this route 502'd in production while green locally)
    const { buildZip } = await import('../lib/zip.js');
    const convs = await listConversations();
    const entries: Array<{ name: string; data: string }> = [];
    const manifest: Array<{ id: string; title: string; project_id: string; messages: number }> = [];
    for (const c of convs) {
      const msgs = await listMessages(c.id);
      const lines = [`# ${c.title}`, ''];
      for (const m of msgs) {
        if (m.kind !== 'text') continue;
        const payload = JSON.parse(m.payload) as { text?: string };
        lines.push(`**${m.role === 'user' ? 'You' : 'Axiom'}:**`, '', payload.text ?? '', '');
      }
      const slug = c.title.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'chat';
      entries.push({ name: `${slug}-${c.id.slice(-6)}.md`, data: lines.join('\n') });
      manifest.push({ id: c.id, title: c.title, project_id: c.project_id, messages: msgs.length });
    }
    entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="axiom-conversations.zip"');
    res.send(buildZip(entries));
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

conversationsRouter.post('/:id/truncate', (req, res) => {
  const { messageId, inclusive } = req.body as { messageId?: string; inclusive?: boolean };
  void (async () => {
    const anchor = messageId ? await findMessage(req.params.id, messageId) : undefined;
    if (!anchor) {
      res.status(404).json({ error: 'message not found' });
      return;
    }
    const deleted = await truncateMessages(req.params.id, anchor.created_at, inclusive === true);
    res.json({ ok: true, deleted });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

conversationsRouter.get('/:id', (req, res) => {
  void (async () => {
    const conv = await getConversation(req.params.id);
    if (!conv) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    const messages = (await listMessages(conv.id)).map((m) => ({
      id: m.id,
      role: m.role,
      kind: m.kind,
      feedback: getSetting(`feedback:${m.id}`) ?? null,
      ...(JSON.parse(m.payload) as Record<string, unknown>),
    }));
    res.json({ ...conv, projectId: conv.project_id, messages });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Thumbs feedback on an assistant message (up | down | null to clear). */
conversationsRouter.post('/:id/feedback', (req, res) => {
  const { messageId, rating } = req.body as { messageId?: string; rating?: 'up' | 'down' | null };
  if (!messageId || (rating !== 'up' && rating !== 'down' && rating !== null)) {
    res.status(400).json({ error: 'messageId and rating (up|down|null) are required' });
    return;
  }
  setSetting(`feedback:${messageId}`, rating ?? '');
  res.json({ ok: true });
});

/** Export the conversation as markdown (claude.ai export parity). */
conversationsRouter.get('/:id/export', (req, res) => {
  void (async () => {
    const conv = await getConversation(req.params.id);
    if (!conv) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    // ?format=json → the raw structured transcript (V8b)
    if (req.query.format === 'json') {
      const msgs = await listMessages(conv.id);
      res.setHeader('Content-Disposition', `attachment; filename="${conv.id}.json"`);
      res.json({ ...conv, messages: msgs.map((m) => ({ ...m, payload: JSON.parse(m.payload) as unknown })) });
      return;
    }
    const rows = await listMessages(conv.id);
    const lines: string[] = [`# ${conv.title}`, '', `_Exported from Axiom · ${new Date().toISOString()}_`, ''];
    for (const m of rows) {
      const p = JSON.parse(m.payload) as { text?: string; artifact?: { name?: string; ver?: number } };
      const who = m.role === 'user' ? '**Adam**' : '**Axiom**';
      if (m.kind === 'pipeline') {
        lines.push(`${who}: _generated artifact ${p.artifact?.name ?? ''} (v${p.artifact?.ver ?? 1})_`, '');
        if (p.text) lines.push(p.text, '');
      } else {
        lines.push(`${who}:`, '', p.text ?? '', '');
      }
    }
    const slug = conv.title.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'chat';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.md"`);
    res.send(lines.join('\n'));
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Delete a conversation AND the memories it produced — a deleted chat must
 * not keep whispering facts into recall (M5 deletion propagation). */
async function deleteWithMemory(id: string): Promise<number> {
  const conv = await getConversation(id);
  const n = await deleteConversation(id);
  if (conv) {
    const { purgeConversationMemory } = await import('../memory/engine.js');
    await purgeConversationMemory(conv.project_id, id).catch(() => undefined);
  }
  return n;
}

conversationsRouter.delete('/:id', (req, res) => {
  deleteWithMemory(req.params.id)
    .then((deleted) => res.json({ ok: true, deleted }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Bulk delete (sidebar select-all flow). Artifacts are kept — they live in the gallery. */
conversationsRouter.post('/delete', (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids[] is required' });
    return;
  }
  void (async () => {
    let deleted = 0;
    for (const id of ids) deleted += await deleteWithMemory(id);
    res.json({ ok: true, deleted });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** V7 chat share (claude.ai parity): snapshot the conversation to a static
 * read-only HTML page in S3, return a 7-day presigned VIEW link (inline, not
 * attachment). Revocable: DELETE removes the object, killing the link. */
conversationsRouter.post('/:id/share', (req, res) => {
  void (async () => {
    const conv = await getConversation(req.params.id);
    if (!conv) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    const msgs = await listMessages(req.params.id);
    const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = msgs
      .filter((m) => m.kind === 'text')
      .map((m) => {
        const payload = JSON.parse(m.payload) as { text?: string };
        const who = m.role === 'user' ? 'You' : 'Axiom';
        return `<div class="msg ${m.role}"><div class="who">${who}</div><div class="body">${esc(payload.text ?? '')}</div></div>`;
      })
      .join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(conv.title)}</title>
<meta name="robots" content="noindex"><style>
body{font-family:-apple-system,Segoe UI,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;background:#faf9f5;color:#1a1917}
.msg{margin:1rem 0;padding:.8rem 1rem;border-radius:12px;white-space:pre-wrap}
.msg.user{background:#eee9df}.msg.assistant{background:#fff;border:1px solid #e3dfd5}
.who{font-size:.75rem;font-weight:600;color:#73716b;margin-bottom:.3rem}
.foot{margin:2rem 0;font-size:.8rem;color:#73716b}</style></head>
<body><h2>${esc(conv.title)}</h2>${rows}<div class="foot">Shared read-only from Axiom · snapshot at share time</div></body></html>`;
    const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { fromIni } = await import('@aws-sdk/credential-providers');
    const { bedrockSettings } = await import('../providers/bedrock.js');
    const s = bedrockSettings();
    const s3 = new S3Client({ region: s.region || 'us-east-1', ...(process.env.AWS_LAMBDA_FUNCTION_NAME ? {} : { credentials: fromIni({ profile: s.profile || 'default' }) }) });
    const bucket = 'atlasv2-uploads-683032473658';
    const key = `shares/conv-${conv.id}/index.html`;
    if (req.body && (req.body as { revoke?: boolean }).revoke) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      res.json({ ok: true, revoked: true });
      return;
    }
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: html, ContentType: 'text/html; charset=utf-8' }));
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 7 * 86_400 });
    res.json({ url, expiresDays: 7 });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** W4 per-chat web-search override ('1'|'0'; clear to fall back to global). */
conversationsRouter.post('/:id/websearch', (req, res) => {
  const { enabled } = req.body as { enabled?: boolean | null };
  setSetting(`websearch:${req.params.id}`, enabled === null || enabled === undefined ? '' : enabled ? '1' : '0');
  res.json({ ok: true });
});

/** P4 per-chat tool toggles (claude.ai tool-menu parity): connectors disabled
 * for THIS conversation only — the project-level toggle stays the master. */
conversationsRouter.get('/:id/tools', (req, res) => {
  const raw = getSetting(`mcpoff:${req.params.id}`);
  res.json({ disabled: raw ? (JSON.parse(raw) as string[]) : [] });
});

conversationsRouter.post('/:id/tools', (req, res) => {
  const { connectorId, enabled } = req.body as { connectorId?: string; enabled?: boolean };
  if (!connectorId) {
    res.status(400).json({ error: 'connectorId is required' });
    return;
  }
  const raw = getSetting(`mcpoff:${req.params.id}`);
  const off = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  if (enabled === false) off.add(connectorId);
  else off.delete(connectorId);
  setSetting(`mcpoff:${req.params.id}`, JSON.stringify([...off]));
  res.json({ ok: true, disabled: [...off] });
});

/** X1 response styles (claude.ai parity): preset per conversation, or a
 * custom descriptor generated once from a pasted writing sample. */
// Concrete length/structure anchors, not just qualitative tone words: "be
// concise"/"be explanatory" alone left a small-tier model's actual compliance
// too variable to reliably differ in length turn to turn (X1 measured this —
// a live model's response length is not deterministic without a hard anchor).
const STYLE_PRESETS: Record<string, string> = {
  normal: '',
  concise: 'STYLE: Be maximally concise — 1-2 short sentences or a tight fragment, whenever the question allows it. No preamble, no recap, no filler, no restating the question. Never pad a short answer to sound more complete.',
  explanatory: 'STYLE: Be thoroughly explanatory, even for a question that could be answered in one line. Define every non-obvious term on first use, walk through the reasoning step by step (never just state the conclusion), and add at least one concrete example or elaboration per point. Longer is correct here — do not compress.',
  formal: 'STYLE: Formal professional register. No contractions, no colloquialisms, complete sentences, measured tone.',
};

conversationsRouter.post('/:id/style', (req, res) => {
  void (async () => {
    const { style, sample } = req.body as { style?: string; sample?: string };
    if (sample?.trim()) {
      // one model call turns a pasted writing sample into a style descriptor
      const { completeText } = await import('../llama/json.js');
      const descriptor = await completeText(
        [
          { role: 'system', content: 'Describe the writing style of the sample in 2-3 imperative sentences an AI assistant could follow (tone, sentence length, vocabulary, structure). Output only the description.' },
          { role: 'user', content: sample.slice(0, 4000) },
        ],
        { maxTokens: 200, temperature: 0.3 },
      );
      setSetting(`style:${req.params.id}`, `STYLE: ${descriptor.trim()}`);
      res.json({ ok: true, style: 'custom', descriptor: descriptor.trim() });
      return;
    }
    if (style === undefined || !(style in STYLE_PRESETS)) {
      res.status(400).json({ error: `style must be one of ${Object.keys(STYLE_PRESETS).join(', ')} (or pass sample)` });
      return;
    }
    setSetting(`style:${req.params.id}`, STYLE_PRESETS[style] ?? '');
    res.json({ ok: true, style });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Per-conversation "remember this chat" toggle (memory capture + recall). */
conversationsRouter.post('/:id/remember', (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) is required' });
    return;
  }
  setRemember(req.params.id, enabled);
  res.json({ ok: true });
});

conversationsRouter.get('/:id/remember', (req, res) => {
  res.json({ remember: rememberEnabled(req.params.id) });
});
