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
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import { readFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { repoRoot } from '../config.js';
import { getSetting, setSetting } from '../db/db.js';
import { logTo } from '../log.js';
import type { ChatMessage } from '../llama/client.js';
import { modelAllowed, runAsAccount } from '../lib/account.js';
import { extractJsonValue } from '../pipeline/validate.js';

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
  /** The model's own hard output ceiling in tokens (models.config.json). Not a
   * budget we impose: generation always asks for the whole thing, so the only
   * limit on a document is the model itself. */
  maxOutput?: number;
  /** Does this model accept a Converse cachePoint and actually serve reads back?
   * MUST be explicit per model — sending a cachePoint to Nemotron fails the whole
   * request, and Nova bills the write but never reads. See CACHE_POINT. */
  promptCache?: boolean;
  /** Measured minimum cacheable prefix in tokens. Below it Bedrock silently
   * declines to cache. Documentation only — the request is unchanged either way;
   * it exists so the cache metrics can be read honestly. */
  cacheMinTokens?: number;
}

/** Only for a model whose config omits maxOutput. Deliberately modest — an
 * unknown model that rejects an oversized request is worse than one that emits
 * less than it could, and the log line below says which model needs a value. */
const CONSERVATIVE_MAX_OUTPUT = 8192;

const FALLBACK_MODELS: ModelDef[] = [
  { key: 'haiku', name: 'Claude Haiku 4.5', sub: 'Fast · Amazon Bedrock', provider: 'bedrock', model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', maxOutput: 64000, vision: true },
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

/** The first model this account can actually run: allowed by its users.config.json
 * list AND with a reachable provider, in catalog order so it matches the top of
 * the dropdown. Falls back to the first allowed model when no provider is
 * reachable — the picker then still renders it with a Connect affordance rather
 * than going blank. */
function firstUsableModel(): ModelDef | undefined {
  const allowed = MODEL_DEFS.filter((m) => modelAllowed(m.key));
  return allowed.find(modelAvailable) ?? allowed[0];
}

/** The model key the user has selected. The config default only wins when this
 * account may actually run it: an account whose allowlist omits the default
 * (users.config.json) resolves to its first usable model instead. Reporting a
 * selection the account can't run makes the UI name one model while
 * activeModelDef() silently infers with another. */
export function activeModelKey(): string {
  const sel = getSetting('selectedModel');
  // an explicit, still-allowed choice is honoured even while its provider is
  // down — that's a Connect prompt, not a reason to move the user off it
  if (isModelKey(sel) && modelAllowed(sel)) return sel;
  const def = MODEL_DEFS.find((m) => m.key === DEFAULT_MODEL_KEY);
  if (def && modelAllowed(def.key) && modelAvailable(def)) return def.key;
  return firstUsableModel()?.key ?? DEFAULT_MODEL_KEY;
}

/** The full model definition for the active selection (always defined). */
export function activeModelDef(): ModelDef {
  // account model limits (users.config.json): re-checked here rather than
  // trusted from activeModelKey — enforcement can't live only in the picker,
  // the inference path must refuse too
  return (
    MODEL_DEFS.find((m) => m.key === activeModelKey() && modelAllowed(m.key)) ??
    firstUsableModel() ??
    MODEL_DEFS[0]!
  );
}

/** The descriptor for the active selection (id/name/sub). */
export function activeModel(): { id: string; name: string; sub: string } {
  const m = activeModelDef();
  return { id: m.model, name: m.name, sub: m.sub };
}

/** Look a model up by its provider-side id (what callers pass as opts.modelId),
 * as opposed to its short config key. */
export function modelDefByModelId(modelId: string): ModelDef {
  return MODEL_DEFS.find((m) => m.model === modelId) ?? activeModelDef();
}

/** The model's own hard output limit in tokens (the CLAMP), distinct from the
 * office budget below (the CAP). Nothing here caps a document short of what the
 * model can produce; officeMaxTokens() applies the deliberate budget. */
export function modelMaxOutput(def: ModelDef = activeModelDef()): number {
  if (def.maxOutput && def.maxOutput > 0) return def.maxOutput;
  logTo('app', `model ${def.key} has no maxOutput in models.config.json — using ${CONSERVATIVE_MAX_OUTPUT}; long output will truncate until it is set`);
  return CONSERVATIVE_MAX_OUTPUT;
}

/** The deliberate output budget for document generation, in tokens. Big enough
 * for a multi-file artifact (the 8-screen react app measured ~18k output
 * tokens) with headroom, while bounding worst-case latency and the Lambda
 * timeout. A request that needs more now truncates HONESTLY — the streaming
 * paths raise TruncatedOutputError naming this cap — rather than silently. */
export const OFFICE_MAX_TOKENS = 24000;

/** The budget actually requested for office generation: the 24k cap, never
 * above the active model's own ceiling (Nova/Nemotron carry a placeholder 8192,
 * and Bedrock rejects an over-limit request). min(cap, clamp). */
export function officeMaxTokens(def: ModelDef = activeModelDef()): number {
  return Math.min(OFFICE_MAX_TOKENS, modelMaxOutput(def));
}

/** The Bedrock inference-profile id for the active selection. */
export function activeModelId(): string {
  return activeModel().id;
}

export function bedrockSettings(): BedrockSettings {
  // the AWS connection is SYSTEM state — every account shares it (accounts
  // partition workspace data, not infrastructure)
  const raw = runAsAccount('adammfisher', () => getSetting('bedrock'));
  // Must NOT resolve a model here. activeModelKey() consults modelAvailable(),
  // which calls straight back into bedrockSettings() — so calling activeModelId()
  // on this branch closes the loop and overflows the stack. It fires exactly
  // when `raw` is null, i.e. before the 'bedrock' setting is cached: every cold
  // start. modelId is display-only back-compat (see the interface), and there is
  // no meaningful model to name while disconnected.
  if (!raw) return { connected: false, region: 'us-east-1', profile: 'default', modelId: '' };
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
  runAsAccount('adammfisher', () =>
    setSetting(
      'bedrock',
      JSON.stringify({ connected: true, region, profile, modelId: activeModelId() } satisfies BedrockSettings),
    ),
  );
  // resolve through activeModelKey so we never persist a key this account is
  // not allowed to run (the config default may be outside its allowlist)
  if (!isModelKey(getSetting('selectedModel'))) setSetting('selectedModel', activeModelKey());
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
  // resolve through activeModelKey so we never persist a key this account is
  // not allowed to run (the config default may be outside its allowlist)
  if (!isModelKey(getSetting('selectedModel'))) setSetting('selectedModel', activeModelKey());
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
function toConverse(messages: ChatMessage[]): { system: SystemContentBlock[]; messages: Message[] } {
  const system: SystemContentBlock[] = [];
  const out: Message[] = [];
  // observer is installed below, after the conversion, so it sees exactly what
  // Converse will receive
  for (const m of messages) {
    if (m.role === 'system') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
      // E: the caller marks the end of the stable prefix with this sentinel; it
      // becomes a real cachePoint block rather than prompt text
      if (text === CACHE_POINT) {
        system.push({ cachePoint: { type: 'default' } });
        continue;
      }
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
  converseObserver?.({ system, messages: out });
  return { system, messages: out };
}

/** Test hook (Deliverables B + E): observe the exact system/message blocks handed
 * to Converse. The prefix byte-stability gates assert on what the model really
 * receives rather than on a re-derivation of it. Never installed in production —
 * nothing calls the setter outside scripts/test. */
type ConverseObserver = (payload: { system: SystemContentBlock[]; messages: Message[] }) => void;
let converseObserver: ConverseObserver | null = null;

export function __setConverseObserver(fn: ConverseObserver | null): void {
  converseObserver = fn;
}

/**
 * DELIVERABLE E — sentinel marking the end of the cacheable stable prefix.
 *
 * A system message whose content is exactly this becomes a Converse cachePoint
 * block. Callers place it after the stable sections (behavior, skills, prefs,
 * project instructions); everything after it is per-turn and stays uncached.
 *
 * Measured against live Bedrock (2026-07-16), because the docs are wrong:
 *   - prefix order is toolConfig -> system -> messages, so a cachePoint at the
 *     end of `system` caches the TOOL DEFINITIONS as well as the system text
 *     (proven: ~210-token system + ~1945-token tools cached 2148 together);
 *   - minimum cacheable prefix, by bisection: 1024 on sonnet (1015 tok does not
 *     cache, 1055 does) and 4096 on haiku (4014 does not, 4114 does). Anthropic's
 *     docs claim 2048 for haiku. Below the minimum Bedrock silently declines to
 *     cache — no error, no cost;
 *   - nova accepts a cachePoint, bills the write, and NEVER reads it back;
 *   - nemotron REJECTS the request outright ("unsupported model or your request
 *     did not allow prompt caching").
 * The last two are why promptCache is an explicit per-model flag rather than a
 * default: enabling it unguarded breaks Nemotron chat entirely.
 */
export const CACHE_POINT = ' atlas:cachePoint ';

/** Does this model support prompt caching? models.config.json `promptCache`. */
export function promptCacheEnabled(def: ModelDef = activeModelDef()): boolean {
  return def.provider === 'bedrock' && def.promptCache === true;
}

/** Token accounting from a Converse response. inputTokens IS the context size —
 * it counts the whole prompt the model read. The cache fields appear only for
 * models with prompt caching enabled (Deliverable E). */
export interface ConverseUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

export interface BedrockCallOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  /** pin a specific inference-profile id (router tier testing + escalation);
   * defaults to the active model so production paths are unchanged. */
  modelId?: string;
  /** Skip constrained decoding (forced tool-use / json_schema) and generate the
   * JSON as an ordinary streamed completion. Constrained decoding on Bedrock is
   * BUFFERED — no tokens reach the client until the whole payload is ready — so
   * a document appears to hang then dump. Plain streaming emits text deltas as
   * they land, which is what the live-write panel needs. The tradeoff is that
   * validity is no longer grammar-guaranteed; the caller's ajv-validate + repair
   * loop covers the rare malformed output (reliable on Claude, the only model
   * the office path uses — see officeGenerationModel). */
  plain?: boolean;
  /** Converse token accounting, including the cache fields (E). Symmetric with
   * bedrockStreamWithTools' onUsage. */
  onUsage?: (usage: ConverseUsage) => void;
}

/** A Claude model produces reliable raw JSON from a plain completion and handles
 * Bedrock tool-use cleanly; Nova/Nemotron do not (they emit malformed or
 * truncated constrained JSON — the "Unexpected end of JSON input" failures). */
export function isClaudeModel(def: ModelDef = activeModelDef()): boolean {
  return /claude|anthropic/i.test(def.model);
}

/** The model document generation runs on. Chat can use any model the account is
 * allowed, but the office/artifact JSON path requires reliable structured output,
 * so the model is chosen by an explicit policy rather than following the chat
 * selection:
 *
 *   Documents run on HAIKU regardless of the selected chat model — it is fast,
 *   cheap, and reliable at structured output — UNLESS the user has deliberately
 *   selected SONNET, in which case documents use Sonnet too (they asked for the
 *   frontier model). Nova/Nemotron and any other/third Claude selection all map
 *   to Haiku; only an explicit Sonnet selection escapes it.
 *
 * The substitution DELIBERATELY IGNORES the account's chat allowlist: office
 * generation is a system capability, not a user-selectable chat model, so an
 * account restricted to Nova/Nemotron for chat still gets Haiku for documents.
 * openai/anthropic API selections pass through — they have their own reliable
 * JSON paths and the Haiku/Sonnet policy is about the bedrock Claude tier. */
export function officeGenerationModel(): ModelDef {
  const active = activeModelDef();
  if (active.provider !== 'bedrock') return active;
  const bedrockConnected = bedrockSettings().connected;
  const usable = (m: ModelDef): boolean =>
    isClaudeModel(m) && (m.provider !== 'bedrock' || bedrockConnected);
  // haiku by default; sonnet ONLY when it is the active selection
  const wantKey = active.key === 'sonnet' ? 'sonnet' : 'haiku';
  const want = MODEL_DEFS.find((m) => m.key === wantKey && usable(m));
  // desired model absent/unreachable (sonnet slot missing, provider down):
  // fall back to any usable Claude, else fail legibly.
  const claude = want ?? MODEL_DEFS.find(usable);
  if (!claude) {
    throw new Error(
      `${active.name} cannot generate documents reliably (non-Claude models produce malformed structured output), ` +
        `and no Claude model is configured. Add a Claude model to models.config.json to create documents.`,
    );
  }
  return claude;
}

/** Declarative per-model capability: native structured outputs (json_schema on
 * Converse). Claude ≥4.5 = true; Nova/Nemotron = false → forced tool-choice.
 * openai/anthropic APIs expose json_schema / tool schemas, so true. */
export function structuredOutputs(def: ModelDef): boolean {
  if (def.provider === 'bedrock') return supportsJsonSchema(def.model);
  return true;
}

/** The model definition for a config key, or undefined. */
export function modelDefByKey(key: string): ModelDef | undefined {
  return MODEL_DEFS.find((m) => m.key === key);
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
  // opts.modelId is the documented tier-pinning escape hatch (BedrockCallOptions);
  // honoring it here matches bedrockCompleteJson and lets the polish evals hold a
  // tier constant. Absent, this is the active model exactly as before.
  const modelId = opts.modelId ?? activeModelId();
  const inferenceConfig = { maxTokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 0.7 };
  if (opts.onDelta) {
    const out = await client.send(
      new ConverseStreamCommand({ modelId, system, messages: msgs, inferenceConfig }),
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
    new ConverseCommand({ modelId, system, messages: msgs, inferenceConfig }),
    { abortSignal: opts.signal },
  );
  if (out.usage) opts.onUsage?.(out.usage as ConverseUsage);
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

/** A wedged call must still surface as a pipeline error rather than an
 * indefinite "waiting for first tokens" spinner — but the old guard was a TOTAL
 * deadline, which silently doubles as an output ceiling: any generation honestly
 * still streaming past it gets killed mid-document. These measure SILENCE
 * instead, so a stalled call trips as before while a long one never does.
 *
 * The two windows differ because Bedrock BUFFERS constrained decoding: on a
 * forced tool-use call it emits nothing until the whole payload is ready, then
 * flushes it in one burst. Measured on the 8-screen react request (Haiku 4.5,
 * 2026-07-15): first fragment at 83s and 93s across two runs, then ~10k
 * fragments inside 7s. So time-to-first-fragment scales with the SIZE of the
 * document, and a first-token window sized like an inter-token one would abort
 * exactly the large generations this change exists to allow. Once bytes are
 * flowing, a real gap is a genuine stall. */
const FIRST_TOKEN_ABORT_MS = 600_000;
const IDLE_ABORT_MS = 120_000;

/** Raised when the model stopped because it ran out of output budget rather
 * than because it finished. Distinct from a parse failure: the JSON is
 * well-formed up to the cut, so the repair loop cannot fix it by trying again —
 * only a bigger budget can. */
export class TruncatedOutputError extends Error {}

/** Bedrock reports a budget stop as stopReason=max_tokens on messageStop. Every
 * streaming path here reads it; nothing used to, which is why hitting the
 * ceiling presented as a mystery rather than a limit. */
function assertNotTruncated(stopReason: string, chars: number): void {
  if (stopReason !== 'max_tokens') return;
  throw new TruncatedOutputError(
    `the model hit its output ceiling after ~${chars} characters and the document is cut off mid-token. ` +
      `Raise maxOutput for this model in models.config.json, or select a model with a larger output limit.`,
  );
}

function idleGuard(external?: AbortSignal): { signal: AbortSignal; alive: () => void; done: () => void } {
  const ctrl = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let seenFirst = false;
  const arm = (ms: number): void => {
    timer = setTimeout(
      () => ctrl.abort(new Error(`Bedrock sent nothing for ${ms / 1000}s${seenFirst ? '' : ' (no first token)'}`)),
      ms,
    );
  };
  arm(FIRST_TOKEN_ABORT_MS);
  const done = (): void => clearTimeout(timer);
  external?.addEventListener('abort', () => { done(); ctrl.abort(external.reason); }, { once: true });
  return {
    signal: ctrl.signal,
    alive: () => {
      clearTimeout(timer);
      // the wide window covers the buffered pre-first-token wait only; after
      // that a gap means a stall, not a big document
      seenFirst = true;
      arm(IDLE_ABORT_MS);
    },
    done,
  };
}

/** Constrained JSON over Converse from a ChatMessage array: json_schema for
 * 4.5+, forced tool-use below. Streams on every path (see viaPlain) — required,
 * not cosmetic: an unbounded maxTokens on a non-streaming call runs past the
 * HTTP read timeout. onDelta receives fragments as they land. */
export async function bedrockCompleteJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: BedrockCallOptions = {},
): Promise<string> {
  if (!bedrockActive()) throw new Error('Bedrock is not connected');
  const client = runtime(bedrockSettings());
  const { system, messages: msgs } = toConverse(messages);
  const modelId = opts.modelId ?? activeModelId();
  // no caller-imposed ceiling: ask for everything the model can emit
  const inferenceConfig = {
    maxTokens: opts.maxTokens ?? modelMaxOutput(opts.modelId ? modelDefByModelId(opts.modelId) : activeModelDef()),
    temperature: opts.temperature ?? 0.2,
  };
  const guard = idleGuard(opts.signal);
  const signal = guard.signal;

  // forced tool-use path — accepts schemas json_schema can't express (maps) and
  // is the fallback when json_schema's grammar compiler chokes on a big schema.
  // did a path already stream deltas to onDelta? (avoids a final full re-emit)
  let streamed = false;

  const healPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
    // tool models sometimes emit a map's ENTRIES at top level, dropping the
    // single required wrapper key ({"index.html": …} instead of {files: {…}}) —
    // heal that shape deterministically before validation
    const required = (schema.required as string[] | undefined) ?? [];
    if (required.length === 1 && required[0] && !(required[0] in payload)) {
      const wrapped = (schema.properties as Record<string, { type?: string }> | undefined)?.[required[0]];
      if (wrapped?.type === 'object' && Object.keys(payload).length > 0) {
        return { [required[0]]: payload };
      }
    }
    return payload;
  };

  const toolConfig = {
    tools: [
      {
        toolSpec: {
          name: 'emit',
          description: 'Emit the document payload.',
          inputSchema: { json: sanitizeForBedrock(schema) as never },
        },
      },
    ],
    toolChoice: { tool: { name: 'emit' } as const },
  };

  const viaToolUse = async (): Promise<string> => {
    // STREAM the tool-use input: Bedrock sends the argument JSON as partial
    // fragments, so the document builds live in the panel instead of the user
    // staring at "waiting for first tokens" until the whole thing lands.
    const out = await client.send(
      new ConverseStreamCommand({ modelId, system, messages: msgs, inferenceConfig, toolConfig }),
      { abortSignal: signal },
    );
    let raw = '';
    let stopReason = '';
    for await (const event of out.stream ?? []) {
      const frag = event.contentBlockDelta?.delta?.toolUse?.input;
      if (frag) {
        guard.alive();
        raw += frag;
        if (opts.onDelta) {
          opts.onDelta(frag);
          streamed = true;
        }
      }
      if (event.messageStop) stopReason = event.messageStop.stopReason ?? '';
    }
    // A max_tokens stop means the JSON is cut off mid-token. Say so — the parse
    // below would otherwise throw a bare "Unexpected end of JSON input" that
    // reads as a model failure rather than a budget one.
    assertNotTruncated(stopReason, raw.length);
    if (!raw.trim()) return '';
    // fragments are a JSON string of the tool input; parse, heal, re-serialize
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify(healPayload(parsed));
  };

  // last-resort: no Bedrock grammar at all. Complex schemas (e.g. the product
  // skill) exceed BOTH json_schema and tool-use constrained-decoding limits;
  // the caller's system prompt already describes the schema and demands raw
  // JSON, and the orchestrator ajv-validates + repairs, so a plain completion
  // is safe and correct here.
  // Streams like every other path. It used to be the lone non-streaming call,
  // which was survivable only while maxTokens was small; with the ceiling gone
  // a single-shot request would sit past the HTTP read timeout and die holding
  // a full document.
  const viaPlain = async (): Promise<string> => {
    const out = await client.send(
      new ConverseStreamCommand({ modelId, system, messages: msgs, inferenceConfig }),
      { abortSignal: signal },
    );
    let raw = '';
    let stopReason = '';
    for await (const event of out.stream ?? []) {
      const frag = event.contentBlockDelta?.delta?.text;
      if (frag) {
        guard.alive();
        raw += frag;
        if (opts.onDelta) {
          opts.onDelta(frag);
          streamed = true;
        }
      }
      if (event.messageStop) stopReason = event.messageStop.stopReason ?? '';
    }
    assertNotTruncated(stopReason, raw.length);
    // strip markdown fences the model may add without constrained decoding,
    // then recover the JSON value itself in case anything trails after it —
    // nothing here structurally stops the model from appending a sentence of
    // commentary the way forced tool-use would (FIXLOG FX-8)
    const fenceStripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    return extractJsonValue(fenceStripped);
  };

  const complex = (msg: string): boolean => /grammar|compilation|timed out|too complex|too large/i.test(msg);
  // Schemas past this size make Bedrock's grammar compiler pathological — the
  // pptx schema (1522 chars, 9-value enum, nested charts) measured ~188s per
  // json_schema call vs 5-7s via forced tool-use with the shape intact
  // (2026-07-14, Haiku 4.5, 3/3 runs). Anything that fits json_schema
  // comfortably is well under 1200 (docx 970, xlsx 707, pdf 688); route the
  // rest to tool-use, whose rare required-key omissions the ajv repair loop
  // already handles.
  const bigSchema = JSON.stringify(schema).length > 1200;

  let content: string;
  try {
  if (opts.plain) {
    // caller opted out of constrained decoding for smooth streaming — the JSON
    // arrives as ordinary text deltas (viaPlain) instead of a buffered burst
    content = await viaPlain();
  } else if (supportsJsonSchema(modelId) && !schemaHasMapProps(schema) && !bigSchema) {
    try {
      // STREAM json_schema output too (docx/xlsx/pdf) — the JSON text arrives
      // as normal content deltas
      const out = await client.send(
        new ConverseStreamCommand({
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
        { abortSignal: signal },
      );
      content = '';
      let stopReason = '';
      for await (const event of out.stream ?? []) {
        const frag = event.contentBlockDelta?.delta?.text;
        if (frag) {
          guard.alive();
          content += frag;
          if (opts.onDelta) {
            opts.onDelta(frag);
            streamed = true;
          }
        }
        if (event.messageStop) stopReason = event.messageStop.stopReason ?? '';
      }
      assertNotTruncated(stopReason, content.length);
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
  } finally {
    guard.done();
  }
  // only emit the whole payload if no path streamed it (viaPlain, or a fallback
  // that didn't stream) — otherwise the panel already filled live
  if (opts.onDelta && content && !streamed) opts.onDelta(content);
  return content;
}

export interface BedrockTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** Rewrite toolUse/toolResult blocks as narrated text, coalescing the result
 * into one text block per message (images pass through untouched).
 *
 * Converse rejects any request carrying tool blocks unless toolConfig is also
 * set, and its toolChoice union has no "none" member — so a round that offers
 * no tools cannot legally replay a tool exchange verbatim. Flattening keeps the
 * gathered material in context while letting the request drop toolConfig. */
function flattenToolBlocks(convo: Message[]): Message[] {
  // toolResult carries only the id, so the name has to come from its toolUse
  const toolNames = new Map<string, string>();
  for (const m of convo) {
    for (const b of m.content ?? []) {
      const tu = (b as { toolUse?: { toolUseId?: string; name?: string } }).toolUse;
      if (tu?.toolUseId) toolNames.set(tu.toolUseId, tu.name ?? 'tool');
    }
  }

  return convo.map((m) => {
    const out: ContentBlock[] = [];
    for (const b of m.content ?? []) {
      const blk = b as {
        toolUse?: { toolUseId?: string; name?: string; input?: unknown };
        toolResult?: { toolUseId?: string; content?: { text?: string }[] };
        text?: string;
      };
      let asText: string | undefined;
      if (blk.toolUse) {
        asText = `[called ${blk.toolUse.name ?? 'tool'} with ${JSON.stringify(blk.toolUse.input ?? {})}]`;
      } else if (blk.toolResult) {
        const name = toolNames.get(blk.toolResult.toolUseId ?? '') ?? 'tool';
        const body = (blk.toolResult.content ?? []).map((c) => c.text ?? '').join('\n');
        asText = `[${name} returned]\n${body}`;
      } else if (blk.text !== undefined) {
        asText = blk.text;
      }
      if (asText === undefined) {
        out.push(b);
        continue;
      }
      // merge into a trailing text block rather than emitting adjacent ones
      const prev = out[out.length - 1] as { text?: string } | undefined;
      if (prev?.text !== undefined) prev.text += `\n\n${asText}`;
      else out.push({ text: asText });
    }
    return { role: m.role, content: out };
  });
}

/** Streaming chat with a Converse tool loop (restores in-chat tool use post
 * llama retirement). Text deltas stream through as they arrive; on
 * stopReason=tool_use the tools are executed, results appended, and the
 * conversation continues — capped at MAX_TOOL_ROUNDS rounds, after which a
 * final tool-free round forces synthesis from what was gathered. */
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
    onUsage?: (usage: ConverseUsage) => void;
    /** pin a specific inference-profile id — same contract as BedrockCallOptions.
     * The tool-decision eval holds the tier constant so what is under test is the
     * tool DESCRIPTIONS, not the model picker. Absent, this is the active model. */
    modelId?: string;
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
  const modelId = opts.modelId ?? activeModelId();
  // thinking applies to the first pass only — tool continuations would need
  // the reasoning blocks replayed verbatim, which buys nothing here
  let think = opts.thinking ?? false;
  // up to N tool-executing rounds, then a final round WITHOUT tools that forces
  // the model to synthesize an answer from what it gathered — so a multi-step
  // research task (fetch → search → fetch → …) never ends mid-process with no reply.
  const MAX_TOOL_ROUNDS = 6;
  for (let iteration = 0; iteration <= MAX_TOOL_ROUNDS; iteration++) {
    const offerTools = iteration < MAX_TOOL_ROUNDS && tools.length > 0;
    const out = await client.send(
      new ConverseStreamCommand({
        modelId,
        system,
        messages: offerTools ? convo : flattenToolBlocks(convo),
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
      // usage rides the terminal metadata frame — one per round of the tool loop
      const usage = event.metadata?.usage;
      if (usage && opts.onUsage) opts.onUsage(usage as ConverseUsage);
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
  /** Without this the tokens still stream over the wire and are simply dropped,
   * leaving the panel dark for the whole generation. */
  onDelta?: (d: string) => void;
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
    { maxTokens: opts.maxTokens, signal: opts.signal, onDelta: opts.onDelta },
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
