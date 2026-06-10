import { Router } from 'express';
import type { Response } from 'express';
import { getDb, newId, now } from '../db/db.js';
import { streamChat, type ChatMessage } from '../llama/client.js';
import { llamaState } from '../llama/spawn.js';
import { logTo } from '../log.js';

const PERSONA =
  'You are Atlas, a fully on-device AI assistant. You run entirely on this machine — nothing the user shares ever leaves it. ' +
  'You help with conversation, analysis, and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and small app prototypes. ' +
  'Be direct, concise, and concrete.';

function sse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Router stub — Stage 1 routes every message to plain chat (real router lands in Stage 3). */
function routeIntent(): { intent: 'chat' } {
  return { intent: 'chat' };
}

export const chatRouter = Router();

chatRouter.post('/:id/messages', async (req, res) => {
  const db = getDb();
  const conv = db
    .prepare('SELECT id, project_id, title FROM conversations WHERE id = ?')
    .get(req.params.id) as { id: string; project_id: string; title: string } | undefined;
  if (!conv) {
    res.status(404).json({ error: 'conversation not found' });
    return;
  }
  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  req.on('close', () => clearInterval(keepAlive));

  const t = now();
  const messageCount = (
    db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conv.id) as {
      n: number;
    }
  ).n;
  const userMsgId = newId('m');
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userMsgId, conv.id, 'user', 'text', JSON.stringify({ text: text.trim() }), t);
  if (messageCount === 0) {
    const title = text.trim().length > 42 ? `${text.trim().slice(0, 42)}…` : text.trim();
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conv.id);
  }
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, conv.id);

  try {
    if (llamaState().status !== 'ready') {
      throw new Error('Local model is offline — llama-server is not ready');
    }
    routeIntent(); // Stage 1: always chat
    sse(res, 'stage', { stage: 'routing' });

    const project = db.prepare('SELECT instructions FROM projects WHERE id = ?').get(conv.project_id) as
      | { instructions: string }
      | undefined;
    const history = (
      db
        .prepare(
          'SELECT role, kind, payload FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 12',
        )
        .all(conv.id) as Array<{ role: 'user' | 'assistant'; kind: string; payload: string }>
    )
      .reverse()
      .filter((m) => m.kind === 'text')
      .map((m): ChatMessage => {
        const payload = JSON.parse(m.payload) as { text?: string };
        return { role: m.role, content: payload.text ?? '' };
      });

    const system = [PERSONA, project?.instructions ? `Project instructions: ${project.instructions}` : '']
      .filter(Boolean)
      .join('\n\n');
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history];

    let full = '';
    for await (const delta of streamChat(messages)) {
      full += delta;
      sse(res, 'token', { delta });
    }

    const assistantId = newId('m');
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(assistantId, conv.id, 'assistant', 'text', JSON.stringify({ text: full }), now());
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conv.id);
    sse(res, 'done', { messageId: assistantId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logTo('app', `chat error: ${message}`);
    sse(res, 'error', { message, retryable: true });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});
