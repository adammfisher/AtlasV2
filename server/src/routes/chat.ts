import { Router } from 'express';
import type { Response } from 'express';
import { getDb, getSetting, newId, now } from '../db/db.js';
import { llamaState } from '../llama/spawn.js';
import { scanModels } from '../llama/models.js';
import { logTo } from '../log.js';
import { streamChatWithTools } from '../mcp/toolloop.js';
import { installFor, callTool } from '../mcp/manager.js';
import { bedrockSettings, bedrockStreamChat } from '../providers/bedrock.js';
import { route } from '../pipeline/router.js';
import { isSkillId, loadSkill, skillEnabled, type SkillId } from '../pipeline/skills.js';
import {
  runCreateDoc,
  runEditDoc,
  PipelineError,
  type PipelinePayload,
} from '../pipeline/orchestrator.js';
import { lastPipelineArtifact } from '../pipeline/artifacts.js';

function sse(res: Response, event: string, data: unknown): void {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
  const abort = new AbortController();
  res.on('close', () => {
    clearInterval(keepAlive);
    if (!res.writableEnded) abort.abort();
  });

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

  const persistAssistant = (kind: 'text' | 'pipeline', payload: unknown): string => {
    const id = newId('m');
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, conv.id, 'assistant', kind, JSON.stringify(payload), now());
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conv.id);
    return id;
  };

  try {
    if (llamaState().status !== 'ready') {
      throw new Error('Local model is offline — llama-server is not ready');
    }

    const project = db
      .prepare('SELECT instructions FROM projects WHERE id = ?')
      .get(conv.project_id) as { instructions: string } | undefined;
    const instructions = project?.instructions ?? '';

    const history = (
      db
        .prepare(
          'SELECT role, kind, payload FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 12',
        )
        .all(conv.id) as Array<{ role: 'user' | 'assistant'; kind: string; payload: string }>
    )
      .reverse()
      .filter((m) => m.kind === 'text')
      .map((m) => {
        const payload = JSON.parse(m.payload) as { text?: string };
        return { role: m.role, content: payload.text ?? '' };
      });

    const routerModel = scanModels().some((m) => m.id === 'e2b' && m.present)
      ? 'Gemma 4 E2B'
      : 'Gemma 4 E4B';
    sse(res, 'step', { state: 'pending', label: `Router · ${routerModel}`, detail: 'classifying the task' });
    const editable = lastPipelineArtifact(conv.id);
    const tRoute = Date.now();
    const routed = await route(history.slice(0, -1), text.trim(), editable !== null);
    const routerMs = Date.now() - tRoute;
    logTo('pipeline', `route conv=${conv.id} intent=${routed.intent} skill=${routed.skill ?? '-'} ms=${routerMs}`);

    if (routed.intent === 'chat') {
      sse(res, 'route', { intent: 'chat' }); // client drops the router row for plain chat
      let full = '';
      const tStream = Date.now();
      let tFirst: number | null = null;
      const chips: Array<{ tool: string; connector: string }> = [];

      // §6.2 memory recall: top-3 hits injected when the memory connector is on
      let recall = '';
      try {
        const memInstall = installFor('memory');
        if (memInstall && (JSON.parse(memInstall.enabled_projects) as string[]).includes(conv.project_id)) {
          const hits = await callTool('memory', conv.project_id, 'memory_search', {
            query: text.trim().slice(0, 200),
            limit: 3,
          });
          if (hits && hits !== 'no memory matches') recall = `Known context:\n${hits}`;
        }
      } catch (err) {
        logTo('mcp', `memory recall skipped: ${err instanceof Error ? err.message : err}`);
      }

      const PERSONA =
        'You are Atlas, a fully on-device AI assistant. You run entirely on this machine — nothing the user shares ever leaves it. ' +
        'You help with conversation, analysis, and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and small app prototypes. ' +
        'Be direct, concise, and concrete.';
      const system = [PERSONA, instructions ? `Project instructions: ${instructions}` : '', recall]
        .filter(Boolean)
        .join('\n\n');

      const useBedrock = getSetting('selectedModel') === 'bedrock' && bedrockSettings().connected;
      const stream = useBedrock
        ? bedrockStreamChat(system, history, abort.signal)
        : streamChatWithTools(history, system, conv.project_id, abort.signal, (chip) => {
            chips.push(chip);
            sse(res, 'tool', chip);
          });
      for await (const delta of stream) {
        if (tFirst === null) {
          tFirst = Date.now();
          logTo('app', `chat ${conv.id}: first delta after ${tFirst - tStream}ms`);
        }
        full += delta;
        sse(res, 'token', { delta });
      }
      const id = persistAssistant('text', chips.length ? { text: full, toolCalls: chips } : { text: full });
      sse(res, 'done', { messageId: id });
      return;
    }

    // one product master per conversation: a create_doc/product call in a
    // conversation that already has a product artifact is an edit of it
    // (Amendment §A4.2/§A8 — field-scoped edits and writeback depend on this)
    if (routed.intent === 'create_doc' && routed.skill === 'product' && editable?.kind === 'product') {
      routed.intent = 'edit_doc';
      logTo('pipeline', `route downgraded to edit_doc — conversation already has product ${editable.artifactId}`);
    }

    // create_doc / edit_doc
    const skillId: SkillId =
      routed.intent === 'edit_doc' && editable && isSkillId(editable.kind)
        ? editable.kind
        : (routed.skill as SkillId);

    if (!skillEnabled(skillId)) {
      const skillName = loadSkill(skillId).name;
      const refusal = `The ${skillName} skill is turned off, so I can't generate that right now. Flip it back on in Skills and ask again — the router will pick it up immediately.`;
      sse(res, 'route', { intent: 'chat' });
      sse(res, 'token', { delta: refusal });
      const id = persistAssistant('text', { text: refusal });
      sse(res, 'done', { messageId: id });
      return;
    }

    const send = (event: string, data: unknown): void => sse(res, event, data);
    let payload: PipelinePayload;
    if (routed.intent === 'edit_doc' && editable) {
      payload = await runEditDoc({
        skillId,
        artifactId: editable.artifactId,
        artifactName: editable.name,
        text: text.trim(),
        projectId: conv.project_id,
        instructions,
        routerMs,
        routerModel,
        send,
        signal: abort.signal,
      });
    } else {
      payload = await runCreateDoc({
        skillId,
        text: text.trim(),
        projectId: conv.project_id,
        instructions,
        routerMs,
        routerModel,
        send,
        signal: abort.signal,
      });
    }
    const id = persistAssistant('pipeline', payload);
    sse(res, 'pipeline', { phase: 'end', duration: payload.duration });
    sse(res, 'done', { messageId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logTo('pipeline', `pipeline error: ${message}`);
    if (!abort.signal.aborted) {
      const honest =
        err instanceof PipelineError
          ? `Generation failed: ${message}`
          : `Something went wrong: ${message}`;
      persistAssistant('text', { text: honest });
      sse(res, 'error', { message: honest, retryable: true });
    }
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});
