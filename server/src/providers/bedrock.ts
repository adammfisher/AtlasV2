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
import { readFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { repoRoot } from '../config.js';
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

/** Model catalog is CONFIG-DRIVEN — edit models.config.json (repo root) to add
 * or remove models from the dropdown. Each entry names a provider: 'bedrock'
 * (the connected AWS account), 'openai' or 'anthropic' (their APIs, keyed by an
 * env var). */
export type Provider = 'bedrock' | 'openai' | 'anthropic';
export interface ModelDef {
  key: string;
  name: string;
  sub: string;
  provider: Provider;
  model: string;
  keyEnv?: string;
  baseUrl?: string;
  vision?: boolean;
}

const FALLBACK_MODELS: ModelDef[] = [
  { key: 'haiku', name: 'Claude Haiku 4.5', sub: 'Fast · Amazon Bedrock', provider: 'bedrock', model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', vision: true },
];

function loadModelConfig(): { models: ModelDef[]; default: string } {
  try {
    const raw = JSON.parse(readFileSync(pathJoin(repoRoot, 'models.config.json'), 'utf8')) as {
      models?: ModelDef[];
      default?: string;
    };
    const models = (raw.models ?? []).filter((m) => m && m.key && m.model && m.provider);
    if (!models.length) throw new Error('no models in config');
    return { models, default: raw.default && models.some((m) => m.key === raw.default) ? raw.default : models[0]!.key };
  } catch (err) {
    logTo('app', `models.config.json unavailable (${err instanceof Error ? err.message : err}) — using fallback`);
    return { models: FALLBACK_MODELS, default: 'haiku' };
  }
}

const MODEL_CFG = loadModelConfig();
export const MODEL_DEFS: ModelDef[] = MODEL_CFG.models;
export const DEFAULT_MODEL_KEY = MODEL_CFG.default;
export const MODEL_KEYS = MODEL_DEFS.map((m) => m.key);

/** A provider is usable when: bedrock is connected, or an API model's key env is set. */
export function modelAvailable(m: ModelDef): boolean {
  if (m.provider === 'bedrock') return bedrockSettings().connected;
  return !!(m.keyEnv && process.env[m.keyEnv]);
}

/** Client-facing catalog keyed by model key (id/name/sub + provider/availability). */
export function modelCatalog(): Record<string, { id: string; name: string; sub: string; provider: Provider; available: boolean; vision: boolean }> {
  const out: Record<string, { id: string; name: string; sub: string; provider: Provider; available: boolean; vision: boolean }> = {};
  for (const m of MODEL_DEFS) {
    out[m.key] = { id: m.model, name: m.name, sub: m.sub, provider: m.provider, available: modelAvailable(m), vision: !!m.vision };
  }
  return out;
}
/** Back-compat export (some callers read BEDROCK_MODELS[key].id/name/sub). */
export const BEDROCK_MODELS = modelCatalog();

/** No-op retained for boot callers — the sonnet slot is now set explicitly in
 * models.config.json (no runtime probe/swap). */
export async function probeSonnet(): Promise<void> {
  return;
}

function isModelKey(v: string | null | undefined): v is string {
  return !!v && MODEL_DEFS.some((m) => m.key === v);
}

/** The model key the user has selected — defaults to the config default. */
export function activeModelKey(): string {
  const sel = getSetting('selectedModel');
  return isModelKey(sel) ? sel : DEFAULT_MODEL_KEY;
}

/** The full model definition for the active selection (always defined). */
export function activeModelDef(): ModelDef {
  return (
    MODEL_DEFS.find((m) => m.key === activeModelKey()) ??
    MODEL_DEFS.find((m) => m.key === DEFAULT_MODEL_KEY) ??
    MODEL_DEFS[0]!
  );
}

/** The descriptor for the active selection (id/name/sub). */
export function activeModel(): { id: string; name: string; sub: string } {
  const m = activeModelDef();
  return { id: m.model, name: m.name, sub: m.sub };
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
    ...(process.env.AWS_LAMBDA_FUNCTION_NAME ? {} : { credentials: fromIni({ profile: settings.profile }) }),
  });
}

/** Connect = a real ListFoundationModels round-trip. Returns the Claude model ids found. */
export async function connectBedrock(region: string, profile: string): Promise<string[]> {
  const client = new BedrockClient({ region, ...(process.env.AWS_LAMBDA_FUNCTION_NAME ? {} : { credentials: fromIni({ profile }) }) });
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
      if (['maxItems', 'minItems', 'maxLength', 'minLength', 'pattern', 'maximum', 'minimum'].includes(key)) continue;
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

/** Bedrock json_schema mode cannot express map types (additionalProperties as
 * a schema — e.g. a file map keyed by filename); those route to the tool-use
 * path, which accepts them. */
function schemaHasMapProps(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(schemaHasMapProps);
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'additionalProperties' && typeof value === 'object' && value !== null) return true;
      if (schemaHasMapProps(value)) return true;
    }
  }
  return false;
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

  // forced tool-use path — accepts schemas json_schema can't express (maps) and
  // is the fallback when json_schema's grammar compiler chokes on a big schema.
  const viaToolUse = async (): Promise<string> => {
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
    let payload = (toolUse?.input ?? {}) as Record<string, unknown>;
    // tool models sometimes emit a map's ENTRIES at top level, dropping the
    // single required wrapper key ({"index.html": …} instead of {files: {…}}) —
    // heal that shape deterministically before validation
    const required = (schema.required as string[] | undefined) ?? [];
    if (required.length === 1 && required[0] && !(required[0] in payload)) {
      const wrapped = (schema.properties as Record<string, { type?: string }> | undefined)?.[required[0]];
      if (wrapped?.type === 'object' && Object.keys(payload).length > 0) {
        payload = { [required[0]]: payload };
      }
    }
    return toolUse ? JSON.stringify(payload) : '';
  };

  // last-resort: no Bedrock grammar at all. Complex schemas (e.g. the product
  // skill) exceed BOTH json_schema and tool-use constrained-decoding limits;
  // the caller's system prompt already describes the schema and demands raw
  // JSON, and the orchestrator ajv-validates + repairs, so a plain completion
  // is safe and correct here.
  const viaPlain = async (): Promise<string> => {
    const out = await client.send(
      new ConverseCommand({ modelId, system, messages: msgs, inferenceConfig }),
      { abortSignal: opts.signal },
    );
    const raw = out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    // strip markdown fences the model may add without constrained decoding
    return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  };

  const complex = (msg: string): boolean => /grammar|compilation|timed out|too complex|too large/i.test(msg);
  // Large/deep schemas reliably blow Bedrock's grammar compiler (which wastes
  // ~60s before erroring). Skip json_schema for them and go straight to
  // tool-use — avoids the timeout and generates fast (the product skill).
  const bigSchema = JSON.stringify(schema).length > 2200;

  let content: string;
  if (supportsJsonSchema(modelId) && !schemaHasMapProps(schema) && !bigSchema) {
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!complex(msg)) throw err;
      // json_schema grammar choked → try tool-use, then plain JSON.
      try {
        logTo('app', `json_schema grammar failed (${msg.slice(0, 50)}) — trying tool-use`);
        content = await viaToolUse();
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        if (!complex(msg2)) throw err2;
        logTo('app', `tool-use too complex (${msg2.slice(0, 50)}) — falling back to plain JSON`);
        content = await viaPlain();
      }
    }
  } else {
    try {
      content = await viaToolUse();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!complex(msg)) throw err;
      logTo('app', `tool-use too complex (${msg.slice(0, 50)}) — falling back to plain JSON`);
      content = await viaPlain();
    }
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
  opts: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    thinking?: boolean;
    onThinking?: (delta: string) => void;
  } = {},
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
  // thinking applies to the first pass only — tool continuations would need
  // the reasoning blocks replayed verbatim, which buys nothing here
  let think = opts.thinking ?? false;
  // up to N tool-executing rounds, then a final round WITHOUT tools that forces
  // the model to synthesize an answer from what it gathered — so a multi-step
  // research task (fetch → search → fetch → …) never ends mid-process with no reply.
  const MAX_TOOL_ROUNDS = 6;
  for (let iteration = 0; iteration <= MAX_TOOL_ROUNDS; iteration++) {
    const offerTools = iteration < MAX_TOOL_ROUNDS;
    const out = await client.send(
      new ConverseStreamCommand({
        modelId: activeModelId(),
        system,
        messages: convo,
        ...(offerTools ? { toolConfig } : {}),
        // extended thinking requires temperature 1 and headroom over the budget
        inferenceConfig: think
          ? { maxTokens: Math.max(opts.maxTokens ?? 2048, 6000), temperature: 1 }
          : { maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 1.0 },
        ...(think ? { additionalModelRequestFields: { thinking: { type: 'enabled', budget_tokens: 4000 } } } : {}),
      }),
      { abortSignal: opts.signal },
    );
    think = false;

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
      const reasoning = (delta?.delta as { reasoningContent?: { text?: string } } | undefined)?.reasoningContent?.text;
      if (reasoning && opts.onThinking) opts.onThinking(reasoning);
      if (delta?.delta?.toolUse?.input !== undefined && delta.contentBlockIndex !== undefined) {
        const tu = toolUses.get(delta.contentBlockIndex);
        if (tu) tu.inputJson += delta.delta.toolUse.input;
      }
      if (event.messageStop) stopReason = event.messageStop.stopReason ?? '';
    }

    // final (no-tools) round, or the model is done → stop
    if (!offerTools || stopReason !== 'tool_use' || toolUses.size === 0) return;

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
