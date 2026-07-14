import { Router } from 'express';
import type { Response } from 'express';
import {
  newId,
  now,
  getSetting,
  getConversation,
  getProject,
  touchConversation,
  countMessages,
  addMessage,
} from '../db/appdb.js';
import { logTo } from '../log.js';
import { installFor, toolsForProject, callTool, type ChatTool } from '../mcp/manager.js';
import { webSearch, webFetch } from '../tools/web.js';
import { bedrockSettings, activeModel, type BedrockTool } from '../providers/bedrock.js';
import { streamWithTools } from '../providers/dispatch.js';
import { attachmentDataUrl, attachmentContent } from './uploads.js';
import { readDocument, listDocuments } from '../tools/documents.js';
import { recallContext, scheduleExtraction, flushProjectPending, rememberEnabled, rememberFact, forgetFact } from '../memory/engine.js';
import { listKnowledge } from '../memory/knowledge.js';

const MEMORY_TOOLS: BedrockTool[] = [
  {
    name: 'remember',
    description:
      'Store a durable fact in long-term memory when the user explicitly asks to remember something. scope "user" = a fact about the user themselves (persists across ALL projects); "project" = a fact about this project.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['fact'],
      properties: {
        fact: { type: 'string', description: 'the fact to remember, one sentence' },
        scope: { type: 'string', enum: ['user', 'project'] },
      },
    },
  },
  {
    name: 'forget',
    description: 'Delete a remembered fact when the user asks to forget something.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'what to forget, in the user’s words' },
        scope: { type: 'string', enum: ['user', 'project'] },
      },
    },
  },
];

const DOC_TOOLS: BedrockTool[] = [
  {
    name: 'read_document',
    description:
      'Open a document attached to this message or stored in this project and read its real contents — for a deck, numbered slides with their bullets, tables, chart data and speaker notes. Use this whenever the user asks about a specific slide, section or number, or when the injected file text looks truncated. Never guess at a document\'s contents: read it.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'the file name, e.g. "knowledge-core-po-flow.pptx"' },
        slides: { type: 'string', description: 'optional slide range for decks, e.g. "3" or "4-9" (default: all)' },
      },
    },
  },
  {
    name: 'list_documents',
    description: 'List the documents readable right now (this message\'s attachments plus this project\'s knowledge files).',
    schema: { type: 'object', additionalProperties: false, properties: {} },
  },
];

const WEB_TOOLS: BedrockTool[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information. Returns titles, URLs and snippets of the top results.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a web page and return its readable text (use after web_search to read a result).',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string' } },
    },
  },
];

function mangle(t: ChatTool): string {
  return `${t.connectorId.replace(/-/g, '_')}__${t.name}`.slice(0, 64);
}
import { type ChatMessage } from '../llama/client.js';
import { route } from '../pipeline/router.js';
import { isSkillId, loadSkill, skillEnabled, type SkillId } from '../pipeline/skills.js';
import {
  runCreateDoc,
  runEditDoc,
  PipelineError,
  type PipelinePayload,
} from '../pipeline/orchestrator.js';
import { lastPipelineArtifact } from '../pipeline/artifacts.js';
import { buildContext } from '../pipeline/context.js';

function sse(res: Response, event: string, data: unknown): void {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const chatRouter = Router();

chatRouter.post('/:id/messages', async (req, res) => {
  const conv = await getConversation(req.params.id);
  if (!conv) {
    res.status(404).json({ error: 'conversation not found' });
    return;
  }
  const { text, attachments, retry, thinking } = req.body as {
    text?: string;
    attachments?: Array<{ id: string; name: string; kind: 'image' | 'document' }>;
    retry?: boolean; // regenerate: reuse the text without persisting a new user message
    thinking?: boolean; // extended thinking (Claude reasoning stream)
  };
  const atts = attachments ?? [];
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
  const messageCount = await countMessages(conv.id);
  if (!retry) {
    await addMessage({
      id: newId('m'),
      conversation_id: conv.id,
      role: 'user',
      kind: 'text',
      payload: JSON.stringify(atts.length ? { text: text.trim(), attachments: atts } : { text: text.trim() }),
      created_at: t,
    });
    if (messageCount === 0) {
      const title = text.trim().length > 42 ? `${text.trim().slice(0, 42)}…` : text.trim();
      await touchConversation(conv.id, { title, updated_at: t });
    }
  }
  await touchConversation(conv.id, { updated_at: t }).catch(() => undefined);

  const persistAssistant = async (kind: 'text' | 'pipeline', payload: unknown): Promise<string> => {
    const id = newId('m');
    await addMessage({
      id,
      conversation_id: conv.id,
      role: 'assistant',
      kind,
      payload: JSON.stringify(payload),
      created_at: now(),
    });
    void touchConversation(conv.id, { updated_at: now() }).catch(() => undefined);
    return id;
  };

  try {
    if (!bedrockSettings().connected) {
      throw new Error('No model connected — open the model menu and connect Amazon Bedrock');
    }

    const project = await getProject(conv.project_id);
    const instructions = project?.instructions ?? '';

    // attachments: documents inject extracted text; images become vision parts.
    // The model relays this text as fact, so a failure must state the real
    // reason: anything describing work in progress gets reported to the user as
    // a live status, and nothing here runs in the background.
    let attachedDocs = '';
    const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
    for (const att of atts) {
      try {
        if (att.kind === 'image') {
          imageParts.push({ type: 'image_url', image_url: { url: await attachmentDataUrl(att.id) } });
          continue;
        }
        const content = await attachmentContent(att.id);
        attachedDocs += content.ok
          ? `\n\n--- Attached file: ${att.name} ---\n${content.text.slice(0, 24_000)}`
          : `\n\n--- Attached file: ${att.name} — COULD NOT BE READ: ${content.error} ---\nTell the user this file could not be read and why. Do not claim an extraction is still running or that you will retry in the background.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logTo('app', `attachment ${att.id} unusable: ${msg}`);
        attachedDocs += `\n\n--- Attached file: ${att.name} — COULD NOT BE READ: ${msg} ---`;
      }
    }

    // context management (FR-2.9): recent window + rolling summary of older
    // turns — long conversations never fall off a cliff
    const { history, summary: convSummary } = await buildContext(conv.id);

    const routerModel = activeModel().name;
    sse(res, 'step', { state: 'pending', label: `Router · ${routerModel}`, detail: 'classifying the task' });
    const editable = await lastPipelineArtifact(conv.id);
    const tRoute = Date.now();
    const routedText = atts.length
      ? `${text.trim()} [attached: ${atts.map((a) => a.name).join(', ')}]`
      : text.trim();
    const routed = await route(history.slice(0, -1), routedText, editable !== null);
    const routerMs = Date.now() - tRoute;
    logTo('pipeline', `route conv=${conv.id} intent=${routed.intent} skill=${routed.skill ?? '-'} ms=${routerMs}`);

    if (routed.intent === 'chat') {
      sse(res, 'route', { intent: 'chat' }); // client drops the router row for plain chat
      let full = '';
      const tStream = Date.now();
      let tFirst: number | null = null;
      const chips: Array<{ tool: string; connector: string }> = [];

      // holistic recall: USER KV + PROJECT KV (capped) + semantic hits from
      // S3 Vectors — AWS-native (MEMORY_DESIGN.md); per-conversation toggle honored
      const memEnabled = await (async () => {
        try {
          const memInstall = await installFor('memory');
          return (
            !!memInstall &&
            (JSON.parse(memInstall.enabled_projects) as string[]).includes(conv.project_id) &&
            rememberEnabled(conv.id)
          );
        } catch {
          return false;
        }
      })();
      let recall = '';
      if (memEnabled) {
        try {
          // just-in-time: fold in anything said in OTHER chats of this project
          // that's still queued, so cross-chat recall is current
          await flushProjectPending(conv.project_id, conv.id);
          recall = await recallContext(conv.project_id, text.trim().slice(0, 200));
        } catch (err) {
          logTo('mcp', `memory recall skipped: ${err instanceof Error ? err.message : err}`);
        }
      }

      const PERSONA =
        `You are Atlas, an AI assistant powered by ${activeModel().name} (Anthropic) running on Amazon Bedrock. ` +
        'You help with conversation, analysis, and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and small app prototypes. ' +
        'Be direct, concise, and concrete.';
      const system = [
        PERSONA,
        memEnabled
          ? 'MEMORY: whenever the user asks you to remember, note, keep in mind, save, or forget something, you MUST call the remember or forget tool BEFORE replying — a plain acknowledgement without the tool call does not persist anything. For "remember for this project" or facts about the work, pass scope "project"; for facts about the user themselves, pass scope "user".'
          : '',
        instructions ? `Project instructions: ${instructions}` : '',
        convSummary ? `Earlier in this conversation (running summary):\n${convSummary}` : '',
        recall,
      ]
        .filter(Boolean)
        .join('\n\n');

      const chatHistory = history.map((m, i) => {
        if (i !== history.length - 1 || m.role !== 'user') return m;
        const fullText = `${m.content}${attachedDocs}`;
        if (imageParts.length === 0) return { ...m, content: fullText };
        return { ...m, content: [{ type: 'text' as const, text: fullText }, ...imageParts] };
      });
      // All inference runs on Bedrock (Claude). The Converse tool loop carries
      // memory (remember/forget), web (search/fetch), and every MCP connector
      // enabled for this project; chips surface each execution in the UI.
      const connectorTools: BedrockTool[] = [];
      const byMangled = new Map<string, ChatTool>();
      // atlas-memory and sqlite are the retired SQLite MCP peers — their tools
      // (memory_upsert, graph_add_fact, …) write to a dead database and shadow
      // the native remember/forget + DynamoDB recall. Never expose them.
      const SHADOW_CONNECTORS = new Set(['atlas-memory', 'memory', 'sqlite']);
      try {
        for (const t of await toolsForProject(conv.project_id)) {
          if (SHADOW_CONNECTORS.has(t.connectorId)) continue;
          const name = mangle(t);
          byMangled.set(name, t);
          connectorTools.push({
            name,
            description: `${t.description} (${t.connectorName})`,
            schema: t.inputSchema as Record<string, unknown>,
          });
        }
      } catch (err) {
        logTo('mcp', `connector tools unavailable: ${err instanceof Error ? err.message : err}`);
      }
      // web search is on by default; the user can toggle it off in the composer
      const webEnabled = getSetting('webSearchEnabled') !== '0';
      // document reads only matter when there is something to read
      const docsReadable = atts.some((a) => a.kind === 'document') || (await listKnowledge(conv.project_id).catch(() => [])).length > 0;
      const tools: BedrockTool[] = [
        ...(memEnabled ? MEMORY_TOOLS : []),
        ...(webEnabled ? WEB_TOOLS : []),
        ...(docsReadable ? DOC_TOOLS : []),
        ...connectorTools,
      ];

      const fullMessages = [{ role: 'system' as const, content: system }, ...(chatHistory as ChatMessage[])];
      const stream = streamWithTools(
        fullMessages,
        tools,
        (name, input) => {
          const scope = input.scope === 'user' ? 'user' : conv.project_id;
          if (name === 'remember') return rememberFact(scope, String(input.fact ?? ''), conv.id);
          if (name === 'forget') return forgetFact(scope, String(input.query ?? ''), conv.project_id);
          if (name === 'web_search') return webSearch(String(input.query ?? ''));
          if (name === 'web_fetch') return webFetch(String(input.url ?? ''));
          if (name === 'read_document') {
            return readDocument(conv.project_id, atts, String(input.name ?? ''), input.slides ? String(input.slides) : undefined);
          }
          if (name === 'list_documents') return listDocuments(conv.project_id, atts);
          const spec = byMangled.get(name);
          if (spec) return callTool(spec.connectorId, conv.project_id, spec.name, input);
          return Promise.resolve(`unknown tool: ${name}`);
        },
        (tool) => {
          const spec = byMangled.get(tool);
          const native = tool.startsWith('web_')
            ? 'web'
            : tool === 'read_document' || tool === 'list_documents'
              ? 'documents'
              : 'memory';
          const chip = { tool: spec?.name ?? tool, connector: spec?.connectorName ?? native };
          chips.push(chip);
          sse(res, 'tool', chip);
        },
        {
          signal: abort.signal,
          thinking: thinking === true,
          onThinking: (delta) => sse(res, 'thinking', { delta }),
        },
      );
      try {
        for await (const delta of stream) {
          if (tFirst === null) {
            tFirst = Date.now();
            logTo('app', `chat ${conv.id}: first delta after ${tFirst - tStream}ms`);
          }
          full += delta;
          sse(res, 'token', { delta });
        }
      } catch (err) {
        // stop button: keep the partial response (claude.ai parity) instead of
        // dropping everything the user watched stream in
        if (abort.signal.aborted) {
          if (full) {
            await persistAssistant('text', chips.length ? { text: full, toolCalls: chips } : { text: full });
            scheduleExtraction(conv.id, conv.project_id);
          }
          return;
        }
        throw err;
      }
      const id = await persistAssistant('text', chips.length ? { text: full, toolCalls: chips } : { text: full });
      scheduleExtraction(conv.id, conv.project_id);
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

    if (!(await skillEnabled(skillId))) {
      const skillName = loadSkill(skillId).name;
      const refusal = `The ${skillName} skill is turned off, so I can't generate that right now. Flip it back on in Skills and ask again — the router will pick it up immediately.`;
      sse(res, 'route', { intent: 'chat' });
      sse(res, 'token', { delta: refusal });
      const id = await persistAssistant('text', { text: refusal });
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
        text: `${text.trim()}${attachedDocs}`,
        projectId: conv.project_id,
        instructions,
        routerMs,
        routerModel,
        send,
        signal: abort.signal,
      });
    } else {
      // pass the conversation so far so "create a deck", "make it a doc", etc.
      // build on what was already discussed instead of a generic placeholder
      const priorContext = [
        convSummary ? `Running summary:\n${convSummary}` : '',
        ...history.slice(0, -1).map((m) => `${m.role === 'assistant' ? 'ASSISTANT' : 'USER'}: ${m.content}`),
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(-9000);
      payload = await runCreateDoc({
        skillId,
        text: `${text.trim()}${attachedDocs}`,
        projectId: conv.project_id,
        instructions,
        context: priorContext || undefined,
        routerMs,
        routerModel,
        send,
        signal: abort.signal,
      });
    }
    const id = await persistAssistant('pipeline', payload);
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
      await persistAssistant('text', { text: honest });
      sse(res, 'error', { message: honest, retryable: true });
    }
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});
