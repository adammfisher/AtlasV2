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
import { webSearchIndexed, webFetchIndexed } from '../tools/web.js';
import { SourceRegistry } from '../tools/sources.js';
import { parseCitations, snippetFor } from '../tools/citations.js';
import { bedrockSettings, activeModel, type BedrockTool } from '../providers/bedrock.js';
import { streamWithTools } from '../providers/dispatch.js';
import { attachmentDataUrl, attachmentContent } from './uploads.js';
import { readDocument, listDocuments, analyzeTable } from '../tools/documents.js';
import { recallContext, scheduleExtraction, flushProjectPending, rememberEnabled, rememberFact, forgetFact } from '../memory/engine.js';
import { scanForNarration } from '../memory/narration.js';
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
  {
    name: 'analyze_table',
    description:
      'Compute exact statistics over an attached CSV/TSV/spreadsheet: row and column counts (operation "shape"), or mean/sum/min/max/count of a named column. ALWAYS use this for counts and aggregates — never estimate them from the visible text.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'operation'],
      properties: {
        name: { type: 'string', description: 'the file name' },
        operation: { type: 'string', enum: ['shape', 'mean', 'sum', 'min', 'max', 'count'] },
        column: { type: 'string', description: 'column name (required except for shape)' },
        sheet: { type: 'string', description: 'sheet name for spreadsheets (default: first)' },
      },
    },
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
import { routeWorkflow, toLegacyRoute, productRoute, type RouterSignals, type RouteResult } from '../pipeline/router.js';
import { isSkillId, loadSkill, skillEnabled, type SkillId } from '../pipeline/skills.js';
import {
  runCreateDoc,
  runEditDoc,
  PipelineError,
  type PipelinePayload,
} from '../pipeline/orchestrator.js';
import { lastPipelineArtifact } from '../pipeline/artifacts.js';
import { OrchestrationError } from '../pipeline/artifactContext.js';
import { buildContext, buildBehaviorBlock, tierForModel, assembleSystemPrompt, skillsMetadata } from '../pipeline/context.js';
import { applyReminder, recordUsage } from '../pipeline/reminder.js';
import { activeModelKey, promptCacheEnabled, CACHE_POINT } from '../providers/bedrock.js';

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
    // three-stage model-agnostic router: deterministic pre-router → LLM
    // classification → escalation/clarify. Full context signals drive Stage 1's
    // deterministic edit detection (the permanent modify-bug fix).
    const signals: RouterSignals = {
      artifactInContext: editable !== null,
      lastArtifactKind: editable?.kind ?? null,
      lastMsgProducedArtifact: editable !== null,
      lastMsgWasSubstantive: history.length > 1,
      fileUploadPresent: atts.some((a) => a.kind === 'document'),
      imageUploadPresent: atts.some((a) => a.kind === 'image'),
      multipleUploads: atts.filter((a) => a.kind === 'document').length > 1,
      uploadKinds: atts.filter((a) => a.kind === 'document').map((a) => a.name.split('.').pop() ?? ''),
      urlInMessage: /(https?:\/\/|www\.)\S+/i.test(text),
    };
    // product master (Atlas concept skill) is handled outside the 35-workflow
    // brain by a conservative pre-check; everything else goes through the brain.
    const productR = productRoute(text.trim(), editable?.kind ?? null);
    let routed: RouteResult;
    let routeLabel: string;
    let workflowId: string | undefined; // drives the memory relevance gate (C.3)
    if (productR) {
      routed = productR;
      routeLabel = `product(${productR.intent})`;
    } else {
      const decision = await routeWorkflow({ message: text.trim(), history: history.slice(0, -1), signals });
      routed = toLegacyRoute(decision, signals, text.trim());
      workflowId = decision.workflowId;
      routeLabel = `${decision.workflowId} stage=${decision.stage} conf=${decision.confidence.toFixed(2)}`;
    }
    const routerMs = Date.now() - tRoute;
    logTo('pipeline', `route conv=${conv.id} ${routeLabel} → intent=${routed.intent} skill=${routed.skill ?? '-'} ms=${routerMs}`);

    if (routed.intent === 'chat') {
      sse(res, 'route', { intent: 'chat' }); // client drops the router row for plain chat
      let full = '';
      let thinkingFull = ''; // V2: reasoning persists with the message
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
      // D: one source registry per turn. Everything the model is shown — search
      // hits, fetched pages, knowledge passages — is registered here with stable
      // indices, and it is the only authority on whether a <cite index> is real.
      const sources = new SourceRegistry();

      let recall = '';
      if (memEnabled) {
        try {
          // just-in-time: fold in anything said in OTHER chats of this project
          // that's still queued, so cross-chat recall is current
          await flushProjectPending(conv.project_id, conv.id);
          // C.3: personal memories are withheld from impersonal technical Q&A;
          // project knowledge is never gated (document Q&A depends on it)
          recall = await recallContext(conv.project_id, text.trim().slice(0, 200), { workflowId, sources });
        } catch (err) {
          logTo('mcp', `memory recall skipped: ${err instanceof Error ? err.message : err}`);
        }
      }

      const PERSONA =
        `You are Atlas, an AI assistant powered by ${activeModel().name} (Anthropic) running on Amazon Bedrock. ` +
        'You help with conversation, analysis, and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and small app prototypes. ' +
        'Be direct, concise, and concrete.';
      // web search: per-chat override wins, else the global default (W4)
      const webConv = getSetting(`websearch:${conv.id}`); // null/'' = no override
      const webEnabled = webConv === '1' || webConv === '0' ? webConv === '1' : getSetting('webSearchEnabled') !== '0';
      const convStyle = getSetting(`style:${conv.id}`) ?? '';
      // D.2: citation rules ride the behavior block whenever this conversation
      // CAN surface indexed sources. Gated on configuration, not on whether this
      // turn happens to have sources — those arrive mid-stream from the tool
      // loop, and a per-turn gate would move the system prefix every turn and
      // destroy the prompt cache (E).
      const knowledgeCount = (await listKnowledge(conv.project_id).catch(() => [])).length;
      const citationsPossible = webEnabled || knowledgeCount > 0;
      // E: explicitly ordered assembly, most-stable first. Sections 1–5 form the
      // cacheable prefix; per-turn material (summary, recall) lands after the
      // cache point so it can never invalidate the tokens before it.
      const assembled = assembleSystemPrompt({
        persona: PERSONA,
        // versioned, tier-appropriate behavior rules (create-vs-edit-vs-describe,
        // artifact-vs-inline, honesty, when-to-search) — the always-on brain rules
        behavior: buildBehaviorBlock(tierForModel(activeModelKey()), { citations: citationsPossible }),
        skills: skillsMetadata(),
        toolNotes: memEnabled
          ? [
              'MEMORY: whenever the user asks you to remember, note, keep in mind, save, or forget something, you MUST call the remember or forget tool BEFORE replying — a plain acknowledgement without the tool call does not persist anything. For "remember for this project" or facts about the work, pass scope "project"; for facts about the user themselves, pass scope "user".',
            ]
          : [],
        preferences: convStyle,
        projectInstructions: instructions,
        conversationSummary: convSummary ?? '',
        memoryRecall: recall,
      });

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
      // P4: per-conversation disabled connectors — never reach the model
      const chatOffRaw = getSetting(`mcpoff:${conv.id}`);
      const chatOff = new Set(chatOffRaw ? (JSON.parse(chatOffRaw) as string[]) : []);
      try {
        for (const t of await toolsForProject(conv.project_id)) {
          if (SHADOW_CONNECTORS.has(t.connectorId)) continue;
          if (chatOff.has(t.connectorId)) continue;
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
      // document reads only matter when there is something to read
      const docsReadable = atts.some((a) => a.kind === 'document') || knowledgeCount > 0;
      const tools: BedrockTool[] = [
        ...(memEnabled ? MEMORY_TOOLS : []),
        ...(webEnabled ? WEB_TOOLS : []),
        ...(docsReadable ? DOC_TOOLS : []),
        ...connectorTools,
      ];

      // B: re-anchor the drift-prone rules on the CURRENT USER MESSAGE when the
      // conversation has run long enough to drift. It rides the user turn, never
      // the system prompt, so the cached system prefix stays byte-identical; and
      // it is never persisted, so the user never sees it.
      const tier = tierForModel(activeModelKey());
      const depth = Math.floor(messageCount / 2) + 1; // approx. user turns incl. this one
      const reminded = applyReminder(chatHistory as ChatMessage[], conv.id, depth, tier);

      // E: the cache point closes the stable prefix. Only emitted for models
      // measured to actually serve cache reads — nemotron REJECTS the request
      // outright when it sees a cachePoint, and nova bills writes it never reads.
      const cacheOn = promptCacheEnabled();
      const fullMessages: ChatMessage[] = [
        { role: 'system', content: assembled.stablePrefix },
        ...(cacheOn ? [{ role: 'system' as const, content: CACHE_POINT }] : []),
        ...(assembled.perTurn ? [{ role: 'system' as const, content: assembled.perTurn }] : []),
        ...reminded.messages,
      ];
      const stream = streamWithTools(
        fullMessages,
        tools,
        (name, input) => {
          const scope = input.scope === 'user' ? 'user' : conv.project_id;
          if (name === 'remember') return rememberFact(scope, String(input.fact ?? ''), conv.id);
          if (name === 'forget') return forgetFact(scope, String(input.query ?? ''), conv.project_id);
          // D.1: both return INDEXED documents registered in `sources`
          if (name === 'web_search') return webSearchIndexed(String(input.query ?? ''), sources);
          if (name === 'web_fetch') return webFetchIndexed(String(input.url ?? ''), sources);
          if (name === 'read_document') {
            return readDocument(conv.project_id, atts, String(input.name ?? ''), input.slides ? String(input.slides) : undefined);
          }
          if (name === 'list_documents') return listDocuments(conv.project_id, atts);
          if (name === 'analyze_table') {
            return analyzeTable(
              conv.project_id,
              atts,
              String(input.name ?? ''),
              String(input.operation ?? ''),
              input.column ? String(input.column) : undefined,
              input.sheet ? String(input.sheet) : undefined,
            );
          }
          const spec = byMangled.get(name);
          if (spec) return callTool(spec.connectorId, conv.project_id, spec.name, input);
          return Promise.resolve(`unknown tool: ${name}`);
        },
        (tool) => {
          const spec = byMangled.get(tool);
          const native = tool.startsWith('web_')
            ? 'web'
            : tool === 'read_document' || tool === 'list_documents' || tool === 'analyze_table'
              ? 'documents'
              : 'memory';
          const chip = { tool: spec?.name ?? tool, connector: spec?.connectorName ?? native };
          chips.push(chip);
          sse(res, 'tool', chip);
        },
        {
          signal: abort.signal,
          thinking: thinking === true,
          onThinking: (delta) => {
            thinkingFull += delta;
            sse(res, 'thinking', { delta });
          },
          // inputTokens is the context size — it feeds the reminder's token
          // trigger on the NEXT turn and the cache metrics (E)
          onUsage: (usage) => {
            recordUsage(conv.id, usage.inputTokens ?? 0);
            logTo(
              'pipeline',
              `usage conv=${conv.id} in=${usage.inputTokens ?? 0} out=${usage.outputTokens ?? 0}` +
                ` cacheRead=${usage.cacheReadInputTokens ?? 0} cacheWrite=${usage.cacheWriteInputTokens ?? 0}`,
            );
          },
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
            // a stopped stream can hold half-written <cite> markup — clean it
            // rather than persisting raw tags into the transcript
            const stopped = parseCitations(full, sources, conv.id);
            await persistAssistant('text', {
              text: stopped.text,
              ...(chips.length ? { toolCalls: chips } : {}),
              ...(thinkingFull ? { thinking: thinkingFull } : {}),
              ...(stopped.citations.length
                ? { citations: stopped.citations.map((c) => ({ ...c, snippet: snippetFor(c, sources) })) }
                : {}),
            });
            scheduleExtraction(conv.id, conv.project_id);
          }
          return;
        }
        throw err;
      }
      // D.3: parse <cite> spans out of the buffered text and validate every index
      // against the registry. Invalid tags are dropped (CITE_INVALID) so an
      // invented citation can never render as a chip — a chip promises the claim
      // is grounded. Offsets index the CLEAN text the client renders.
      const parsed = parseCitations(full, sources, conv.id);
      const citations = parsed.citations.map((c) => ({ ...c, snippet: snippetFor(c, sources) }));
      full = parsed.text;
      if (parsed.citations.length || parsed.invalid) {
        logTo('pipeline', `citations conv=${conv.id} valid=${parsed.citations.length} dropped=${parsed.invalid} sources=${sources.size}`);
      }
      // The client rendered raw deltas as they streamed, so it is showing <cite>
      // markup right now. Hand it the clean text WITH the citations in one event
      // so the markup is replaced by chips in a single paint.
      if (citations.length || parsed.invalid) sse(res, 'citations', { text: full, citations });

      // C.2: scan the BUFFERED final text (a phrase can straddle two SSE deltas).
      // Logs MEMORY_NARRATION; never blocks or rewrites — the user has already
      // watched this stream, and a false positive eating a real answer is worse
      // than the tic it would remove.
      if (memEnabled) scanForNarration(full, conv.id);

      const id = await persistAssistant('text', {
        text: full,
        ...(chips.length ? { toolCalls: chips } : {}),
        ...(thinkingFull ? { thinking: thinkingFull } : {}),
        // stored with the message so chips survive a reload
        ...(citations.length ? { citations } : {}),
      });
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
        convId: conv.id,
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
      // edit-state missing: NEVER describe or invent the artifact — ask which
      // one to edit (the permanent modify-bug guard, surfaced honestly).
      if (err instanceof OrchestrationError) {
        const ask =
          "I can't find the file or artifact you want me to edit — which one do you mean? " +
          'Point me at the deck, document, sheet, or code and I\'ll make the change to it.';
        sse(res, 'route', { intent: 'chat' });
        sse(res, 'token', { delta: ask });
        const id = await persistAssistant('text', { text: ask });
        sse(res, 'done', { messageId: id });
        return;
      }
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
