/**
 * Bedrock provider (PRD §8): Converse/ConverseStream via a named AWS profile
 * (default credential chain). This is now Atlas's ONLY inference backend — the
 * local llama tiers are retired. Two selectable models: Claude Haiku 4.5 and
 * Claude Sonnet 5, both US cross-region inference profiles. The user's menu
 * pick (`selectedModel`) drives every call — router, chat, and the document
 * pipeline. Structured outputs use json_schema response format (both models are
 * 4.5+); older ids fall back to forced tool-use. Never combined with citations.
 */
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import { getSetting, setSetting } from '../db/db.js';
import { logTo } from '../log.js';
import type { ChatMessage } from '../llama/client.js';

export interface BedrockSettings {
  connected: boolean;
  region: string;
  profile: string;
  /** kept for display/back-compat; live selection is driven by selectedModel */
  modelId: string;
}

/** The only two models Atlas exposes — both ACTIVE inference profiles in us-east-1. */
export const BEDROCK_MODELS: Record<string, { id: string; name: string; sub: string }> = {
  haiku: {
    id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    name: 'Claude Haiku 4.5',
    sub: 'Fast · Amazon Bedrock',
  },
  sonnet: {
    id: 'us.anthropic.claude-sonnet-5',
    name: 'Claude Sonnet 5',
    sub: 'Most capable · Amazon Bedrock',
  },
};
export const DEFAULT_MODEL_KEY = 'haiku';
export const MODEL_KEYS = Object.keys(BEDROCK_MODELS);

/** Sonnet 5's model agreement is ACTIVE on this account but AWS runtime can
 * still refuse it while activation propagates (or pending a manual AWS grant).
 * Until it clears, the sonnet slot binds to Sonnet 4.5 — honestly labeled —
 * and auto-upgrades to Sonnet 5 once a probe succeeds. */
const SONNET_45 = {
  id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  name: 'Claude Sonnet 4.5',
  sub: 'Most capable available · Amazon Bedrock (Sonnet 5 pending AWS activation)',
};

/** The live catalog: BEDROCK_MODELS with the sonnet slot resolved to whatever
 * this account can actually invoke (probed at connect time). */
export function modelCatalog(): Record<string, { id: string; name: string; sub: string }> {
  if (getSetting('sonnetResolved') === '4.5') return { ...BEDROCK_MODELS, sonnet: SONNET_45 };
  return BEDROCK_MODELS;
}

/** 1-token probe: can this account invoke Sonnet 5 right now? Binds the sonnet
 * slot accordingly. Cheap, non-fatal, safe to call on every boot/refresh. */
export async function probeSonnet(): Promise<void> {
  const settings = bedrockSettings();
  if (!settings.connected) return;
  const client = runtime(settings);
  try {
    await client.send(
      new ConverseCommand({
        modelId: BEDROCK_MODELS.sonnet!.id,
        messages: [{ role: 'user', content: [{ text: 'ping' }] }],
        inferenceConfig: { maxTokens: 1 },
      }),
    );
    if (getSetting('sonnetResolved') !== '5') logTo('app', 'Sonnet 5 is live on this account — sonnet slot upgraded');
    setSetting('sonnetResolved', '5');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not available for this account/i.test(msg)) {
      if (getSetting('sonnetResolved') !== '4.5') {
        logTo('app', 'Sonnet 5 refused by AWS runtime — sonnet slot bound to Sonnet 4.5 until activation clears');
      }
      setSetting('sonnetResolved', '4.5');
    }
    // other errors (throttle, network) leave the current binding untouched
  }
}

function isModelKey(v: string | null | undefined): v is string {
  return !!v && Object.prototype.hasOwnProperty.call(BEDROCK_MODELS, v);
}

/** The model key (haiku|sonnet) the user has selected — defaults to haiku. */
export function activeModelKey(): string {
  const sel = getSetting('selectedModel');
  return isModelKey(sel) ? sel : DEFAULT_MODEL_KEY;
}

/** The full descriptor for the active selection (always defined). */
export function activeModel(): { id: string; name: string; sub: string } {
  const catalog = modelCatalog();
  return catalog[activeModelKey()] ?? catalog[DEFAULT_MODEL_KEY]!;
}

/** The Bedrock inference-profile id for the active selection. */
export function activeModelId(): string {
  return activeModel().id;
}

export function bedrockSettings(): BedrockSettings {
  const raw = getSetting('bedrock');
  if (!raw) return { connected: false, region: 'us-east-1', profile: 'default', modelId: activeModelId() };
  return JSON.parse(raw) as BedrockSettings;
}

/** Bedrock is the only backend — "active" simply means a verified connection. */
export function bedrockActive(): boolean {
  return bedrockSettings().connected;
}

function runtime(settings: BedrockSettings): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: settings.region,
    credentials: fromIni({ profile: settings.profile }),
  });
}

/** Connect = a real ListFoundationModels round-trip. Returns the Claude model ids found. */
export async function connectBedrock(region: string, profile: string): Promise<string[]> {
  const client = new BedrockClient({ region, credentials: fromIni({ profile }) });
  const out = await client.send(new ListFoundationModelsCommand({ byProvider: 'anthropic' }));
  const ids = (out.modelSummaries ?? []).map((m) => m.modelId ?? '').filter(Boolean);
  setSetting(
    'bedrock',
    JSON.stringify({ connected: true, region, profile, modelId: activeModelId() } satisfies BedrockSettings),
  );
  if (!isModelKey(getSetting('selectedModel'))) setSetting('selectedModel', DEFAULT_MODEL_KEY);
  logTo('app', `bedrock connected: ${region}/${profile} (${ids.length} anthropic models)`);
  return ids;
}

/**
 * Boot-time auto-connect so the app is usable out of the box. Uses stored
 * region/profile when present, else us-east-1 / the default profile. Failures
 * are non-fatal — the model menu shows a Connect action and chat returns an
 * honest error until credentials resolve.
 */
export async function ensureBedrockConnected(): Promise<void> {
  const s = bedrockSettings();
  // migrate legacy selections (auto / local tiers) onto a real Claude model
  if (!isModelKey(getSetting('selectedModel'))) setSetting('selectedModel', DEFAULT_MODEL_KEY);
  if (s.connected) {
    void probeSonnet();
    return;
  }
  try {
    await connectBedrock(s.region || 'us-east-1', s.profile || 'default');
    void probeSonnet();
  } catch (err) {
    logTo('app', `bedrock auto-connect skipped: ${err instanceof Error ? err.message : err}`);
  }
}

export function disconnectBedrock(): void {
  const s = bedrockSettings();
  setSetting('bedrock', JSON.stringify({ ...s, connected: false }));
}

/** Claude 4.5+ supports native json_schema response format on Converse. */
export function supportsJsonSchema(modelId: string): boolean {
  const m = /claude-(?:sonnet|opus|haiku)-(\d+)-(\d+)/.exec(modelId);
  if (!m) {
    // unversioned inference profiles (e.g. claude-sonnet-5) are 5.x → supported
    return /claude-(?:sonnet|opus|haiku)-([5-9]|\d{2,})\b/.test(modelId);
  }
  const [, major, minor] = m;
  return Number(major) > 4 || (Number(major) === 4 && Number(minor) >= 5);
}

/** Bedrock structured outputs accept a JSON Schema subset — strip what it
 * rejects (size constraints). ajv still validates the result against the FULL
 * schema afterward, so nothing is lost, only deferred to the repair loop. */
function sanitizeForBedrock(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeForBedrock);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (['maxItems', 'minItems', 'maxLength', 'minLength', 'pattern'].includes(key)) continue;
      out[key] = sanitizeForBedrock(value);
    }
    return out;
  }
  return node;
}

/** Convert Atlas ChatMessages (OpenAI-ish, with data-URL images) into the
 * Converse shape: system blocks pulled out, user/assistant turns as content
 * blocks. Images arrive as `data:image/<fmt>;base64,...` and become image
 * blocks; jpg is normalized to jpeg (Converse's enum). */
function toConverse(messages: ChatMessage[]): { system: Array<{ text: string }>; messages: Message[] } {
  const system: Array<{ text: string }> = [];
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
      if (text.trim()) system.push({ text });
      continue;
    }
    const blocks: ContentBlock[] = [];
    if (typeof m.content === 'string') {
      if (m.content) blocks.push({ text: m.content });
    } else {
      for (const part of m.content) {
        if (part.type === 'text') {
          if (part.text) blocks.push({ text: part.text });
        } else if (part.type === 'image_url') {
          const match = /^data:image\/([a-zA-Z]+);base64,(.+)$/s.exec(part.image_url.url);
          const fmtRaw = match?.[1];
          const b64 = match?.[2];
          if (fmtRaw && b64) {
            const fmt = fmtRaw.toLowerCase() === 'jpg' ? 'jpeg' : fmtRaw.toLowerCase();
            blocks.push({
              image: {
                format: fmt as 'png' | 'jpeg' | 'gif' | 'webp',
                source: { bytes: new Uint8Array(Buffer.from(b64, 'base64')) },
              },
            });
          }
        }
      }
    }
    // Converse rejects empty content blocks — guarantee at least one
    if (blocks.length === 0) blocks.push({ text: ' ' });
    out.push({ role: m.role, content: blocks });
  }
  return { system, messages: out };
}

export interface BedrockCallOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

/** Plain text completion over Converse (mermaid/svg/md emission, summaries).
 * Streams to onDelta when provided. */
export async function bedrockCompleteText(
  messages: ChatMessage[],
  opts: BedrockCallOptions = {},
): Promise<string> {
  if (!bedrockActive()) throw new Error('Bedrock is not connected');
  const client = runtime(bedrockSettings());
  const { system, messages: msgs } = toConverse(messages);
  const inferenceConfig = { maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 0.7 };
  if (opts.onDelta) {
    const out = await client.send(
      new ConverseStreamCommand({ modelId: activeModelId(), system, messages: msgs, inferenceConfig }),
      { abortSignal: opts.signal },
    );
    let content = '';
    for await (const event of out.stream ?? []) {
      const delta = event.contentBlockDelta?.delta?.text;
      if (delta) {
        content += delta;
        opts.onDelta(delta);
      }
    }
    return content;
  }
  const out = await client.send(
    new ConverseCommand({ modelId: activeModelId(), system, messages: msgs, inferenceConfig }),
    { abortSignal: opts.signal },
  );
  return out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
}

/** Constrained JSON over Converse from a ChatMessage array: json_schema for
 * 4.5+, forced tool-use below. Non-streaming (constrained decoding); when
 * onDelta is set the full payload is emitted once so live-write UIs still fill. */
export async function bedrockCompleteJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: BedrockCallOptions = {},
): Promise<string> {
  if (!bedrockActive()) throw new Error('Bedrock is not connected');
  const client = runtime(bedrockSettings());
  const { system, messages: msgs } = toConverse(messages);
  const modelId = activeModelId();
  const inferenceConfig = { maxTokens: opts.maxTokens ?? 3072, temperature: opts.temperature ?? 0.2 };

  let content: string;
  if (supportsJsonSchema(modelId)) {
    const out = await client.send(
      new ConverseCommand({
        modelId,
        system,
        messages: msgs,
        inferenceConfig,
        outputConfig: {
          textFormat: {
            type: 'json_schema',
            structure: { jsonSchema: { name: 'payload', schema: JSON.stringify(sanitizeForBedrock(schema)) } },
          },
        },
      }),
      { abortSignal: opts.signal },
    );
    content = out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
  } else {
    const out = await client.send(
      new ConverseCommand({
        modelId,
        system,
        messages: msgs,
        inferenceConfig,
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: 'emit',
                description: 'Emit the document payload.',
                inputSchema: { json: sanitizeForBedrock(schema) as never },
              },
            },
          ],
          toolChoice: { tool: { name: 'emit' } },
        },
      }),
      { abortSignal: opts.signal },
    );
    const toolUse = out.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
    content = toolUse ? JSON.stringify(toolUse.input ?? {}) : '';
  }
  if (opts.onDelta && content) opts.onDelta(content);
  return content;
}

export interface BedrockTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** Streaming chat with a Converse tool loop (restores in-chat tool use post
 * llama retirement). Text deltas stream through as they arrive; on
 * stopReason=tool_use the tools are executed, results appended, and the
 * conversation continues — capped at 3 iterations. */
export async function* bedrockStreamWithTools(
  messages: ChatMessage[],
  tools: BedrockTool[],
  execute: (name: string, input: Record<string, unknown>) => Promise<string>,
  onTool: (name: string) => void,
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  if (!bedrockActive()) throw new Error('Bedrock is not connected');
  const client = runtime(bedrockSettings());
  const { system, messages: msgs } = toConverse(messages);
  const toolConfig = {
    tools: tools.map((t) => ({
      toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.schema as never } },
    })),
  };

  const convo: Message[] = [...msgs];
  for (let iteration = 0; iteration < 3; iteration++) {
    const out = await client.send(
      new ConverseStreamCommand({
        modelId: activeModelId(),
        system,
        messages: convo,
        toolConfig,
        inferenceConfig: { maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 1.0 },
      }),
      { abortSignal: opts.signal },
    );

    let text = '';
    let stopReason = '';
    const toolUses = new Map<number, { toolUseId: string; name: string; inputJson: string }>();
    for await (const event of out.stream ?? []) {
      const start = event.contentBlockStart;
      if (start?.start?.toolUse && start.contentBlockIndex !== undefined) {
        toolUses.set(start.contentBlockIndex, {
          toolUseId: start.start.toolUse.toolUseId ?? '',
          name: start.start.toolUse.name ?? '',
          inputJson: '',
        });
      }
      const delta = event.contentBlockDelta;
      if (delta?.delta?.text) {
        text += delta.delta.text;
        yield delta.delta.text;
      }
      if (delta?.delta?.toolUse?.input !== undefined && delta.contentBlockIndex !== undefined) {
        const tu = toolUses.get(delta.contentBlockIndex);
        if (tu) tu.inputJson += delta.delta.toolUse.input;
      }
      if (event.messageStop) stopReason = event.messageStop.stopReason ?? '';
    }

    if (stopReason !== 'tool_use' || toolUses.size === 0) return;

    // execute the requested tools, append the exchange, and continue
    const assistantBlocks: ContentBlock[] = [];
    if (text) assistantBlocks.push({ text });
    const resultBlocks: ContentBlock[] = [];
    for (const tu of toolUses.values()) {
      let input: Record<string, unknown> = {};
      try {
        input = tu.inputJson ? (JSON.parse(tu.inputJson) as Record<string, unknown>) : {};
      } catch {
        // malformed args — pass empty input; the tool reports its own error
      }
      assistantBlocks.push({ toolUse: { toolUseId: tu.toolUseId, name: tu.name, input: input as never } });
      onTool(tu.name);
      let result: string;
      try {
        result = await execute(tu.name, input);
      } catch (err) {
        result = `tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      resultBlocks.push({ toolResult: { toolUseId: tu.toolUseId, content: [{ text: result }] } });
    }
    convo.push({ role: 'assistant', content: assistantBlocks });
    convo.push({ role: 'user', content: resultBlocks });
  }
}

/** Streaming chat over Converse from a ChatMessage array (text + images). */
export async function* bedrockStreamMessages(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  if (!bedrockActive()) throw new Error('Bedrock is not connected');
  const client = runtime(bedrockSettings());
  const { system, messages: msgs } = toConverse(messages);
  const out = await client.send(
    new ConverseStreamCommand({
      modelId: activeModelId(),
      system,
      messages: msgs,
      inferenceConfig: { maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 1.0 },
    }),
    { abortSignal: opts.signal },
  );
  for await (const event of out.stream ?? []) {
    const delta = event.contentBlockDelta?.delta?.text;
    if (delta) yield delta;
  }
}

// ── Legacy narrow entry points (kept for callers that pass system+user) ──────

export interface BedrockJsonOptions {
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Constrained JSON on Bedrock from a (system, user) pair. */
export async function bedrockJson(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  opts: BedrockJsonOptions = {},
): Promise<string> {
  return bedrockCompleteJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema,
    { maxTokens: opts.maxTokens, signal: opts.signal },
  );
}

/** Streaming chat on Bedrock from a plain text history + system prompt. */
export async function* bedrockStreamChat(
  system: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  yield* bedrockStreamMessages(
    [{ role: 'system', content: system }, ...history],
    { signal },
  );
}
