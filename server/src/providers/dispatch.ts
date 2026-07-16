/**
 * Provider dispatch: routes the three inference entry points to the provider
 * named by the active model (models.config.json). Bedrock is the default and
 * its path is unchanged; openai/anthropic adapters activate when their model is
 * selected and its API key is present.
 */
import {
  activeModelDef,
  bedrockActive,
  bedrockStreamWithTools,
  bedrockCompleteJson,
  bedrockCompleteText,
  modelDefByKey,
  officeGenerationModel,
  structuredOutputs as modelStructuredOutputs,
  type BedrockTool,
  type ConverseUsage,
  type ModelDef,
} from './bedrock.js';
import * as openai from './openai.js';
import * as anthropic from './anthropic.js';
import { modelAllowed } from '../lib/account.js';
import { logTo } from '../log.js';
import type { ChatMessage } from '../llama/client.js';

/** Is the active model's cloud backend ready (bedrock connected, or API key set)? */
export function cloudReady(): boolean {
  const def = activeModelDef();
  if (def.provider === 'bedrock') return bedrockActive();
  return !!(def.keyEnv && process.env[def.keyEnv]);
}

export function streamWithTools(
  messages: ChatMessage[],
  tools: BedrockTool[],
  execute: (name: string, input: Record<string, unknown>) => Promise<string>,
  onTool: (name: string) => void,
  opts: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    thinking?: boolean;
    onThinking?: (d: string) => void;
    /** per-round Converse token accounting; bedrock only (openai/anthropic ignore it) */
    onUsage?: (usage: ConverseUsage) => void;
  } = {},
): AsyncGenerator<string> {
  const p = activeModelDef().provider;
  if (p === 'openai') return openai.streamWithTools(messages, tools, execute, onTool, opts);
  if (p === 'anthropic') return anthropic.streamWithTools(messages, tools, execute, onTool, opts);
  return bedrockStreamWithTools(messages, tools, execute, onTool, opts);
}

export function completeJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal; onDelta?: (d: string) => void } = {},
): Promise<string> {
  const p = activeModelDef().provider;
  if (p === 'openai') return openai.completeJson(messages, schema, opts);
  if (p === 'anthropic') return anthropic.completeJson(messages, schema, opts);
  return bedrockCompleteJson(messages, schema, opts);
}

/** The document-generation entry point. Differs from completeJson in two ways
 * the office/artifact path needs:
 *   1. It runs on a Claude model (officeGenerationModel) — a non-Claude bedrock
 *      selection is substituted, since Nova/Nemotron emit malformed structured
 *      output. Returns the chosen model so the pipeline can label it honestly.
 *   2. On bedrock it uses PLAIN streaming (no constrained decoding) so the
 *      live-write panel fills progressively instead of hanging then dumping.
 * The caller's ajv-validate + repair loop backstops validity. */
export function completeJsonOffice(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal; onDelta?: (d: string) => void } = {},
): { model: ModelDef; result: Promise<string> } {
  const model = officeGenerationModel(); // throws a legible error if none available
  if (model.provider === 'openai') return { model, result: openai.completeJson(messages, schema, opts) };
  if (model.provider === 'anthropic') return { model, result: anthropic.completeJson(messages, schema, opts) };
  return { model, result: bedrockCompleteJson(messages, schema, { ...opts, modelId: model.model, plain: true }) };
}

export function completeText(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal; onDelta?: (d: string) => void } = {},
): Promise<string> {
  const p = activeModelDef().provider;
  if (p === 'openai') return openai.completeText(messages, opts).then((t) => (opts.onDelta?.(t), t));
  if (p === 'anthropic') return anthropic.completeText(messages, opts).then((t) => (opts.onDelta?.(t), t));
  return bedrockCompleteText(messages, opts);
}

/** Resolve a pinned model key to its definition. The account allowlist
 * (users.config.json) is enforced HERE and not only at the call site: every
 * pinned-model entry point below turns this into a provider-side model id, which
 * skips the clamp inside activeModelDef(). A key outside the account's list
 * falls back to that account's own active model. Background work runs as the
 * primary account, which is allowed everything, so this is a no-op there. */
function resolveModel(modelKey?: string): ModelDef {
  const def = modelKey ? modelDefByKey(modelKey) : undefined;
  if (def && !modelAllowed(def.key)) {
    logTo('app', `model ${def.key} is outside this account's allowlist — falling back to its active model`);
    return activeModelDef();
  }
  return def ?? activeModelDef();
}

/** Does the given model (by key; default active) expose native structured
 * outputs? False → the router must force tool-choice. */
export function structuredOutputs(modelKey?: string): boolean {
  return modelStructuredOutputs(resolveModel(modelKey));
}

/**
 * Plain text completion pinned to a SPECIFIC model. Mirrors classifyJson for the
 * unconstrained path: the polish evals hold a tier constant (small/mid/frontier)
 * so what is under test is the prompt, not the model selection. Production chat
 * keeps using completeText / streamWithTools on the active model.
 */
export function completeTextAs(
  modelKey: string,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const def = resolveModel(modelKey);
  if (def.provider === 'openai') return openai.completeText(messages, opts);
  if (def.provider === 'anthropic') return anthropic.completeText(messages, opts);
  return bedrockCompleteText(messages, { ...opts, modelId: def.model });
}

/**
 * Constrained-JSON classification pinned to a SPECIFIC model (router Stage 2 +
 * escalation). Bedrock pins the inference-profile id; the constrained path then
 * auto-selects json_schema (structured-output models) vs forced tool-choice
 * (Nova/Nemotron) by the same capability. openai/anthropic use their configured
 * model (the defined tiers are all bedrock).
 */
export function classifyJson(
  modelKey: string,
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const def = resolveModel(modelKey);
  if (def.provider === 'openai') return openai.completeJson(messages, schema, opts);
  if (def.provider === 'anthropic') return anthropic.completeJson(messages, schema, opts);
  return bedrockCompleteJson(messages, schema, { ...opts, modelId: def.model });
}
