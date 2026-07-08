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
  type BedrockTool,
} from './bedrock.js';
import * as openai from './openai.js';
import * as anthropic from './anthropic.js';
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
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal; thinking?: boolean; onThinking?: (d: string) => void } = {},
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

export function completeText(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal; onDelta?: (d: string) => void } = {},
): Promise<string> {
  const p = activeModelDef().provider;
  if (p === 'openai') return openai.completeText(messages, opts).then((t) => (opts.onDelta?.(t), t));
  if (p === 'anthropic') return anthropic.completeText(messages, opts).then((t) => (opts.onDelta?.(t), t));
  return bedrockCompleteText(messages, opts);
}
