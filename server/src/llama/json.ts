import { config } from '../config.js';
import { logTo } from '../log.js';
import type { ChatMessage } from './client.js';

export interface JsonCallOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Non-streaming constrained-JSON completion against the local llama-server
 * (response_format json_schema → GBNF). Returns the raw content string —
 * callers parse + ajv-validate so first-pass validity is measurable.
 */
export async function completeJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: JsonCallOptions = {},
): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${config.llamaServer.chatPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal ?? null,
    body: JSON.stringify({
      messages,
      response_format: { type: 'json_schema', json_schema: { schema } },
      temperature: opts.temperature ?? 0.2,
      top_p: 0.95,
      top_k: 64,
      max_tokens: opts.maxTokens ?? 3072,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) {
    throw new Error(`llama-server responded ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? '';
  if (!content) {
    logTo(
      'pipeline',
      `completeJson empty content: finish=${choice?.finish_reason} reasoning_len=${choice?.message?.reasoning_content?.length ?? 0}`,
    );
  }
  return content;
}

/** Plain non-streaming completion (mermaid/svg/md emission, summaries). */
export async function completeText(
  messages: ChatMessage[],
  opts: JsonCallOptions = {},
): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${config.llamaServer.chatPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal ?? null,
    body: JSON.stringify({
      messages,
      temperature: opts.temperature ?? 0.7,
      top_p: 0.95,
      top_k: 64,
      max_tokens: opts.maxTokens ?? 2048,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) {
    throw new Error(`llama-server responded ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}
