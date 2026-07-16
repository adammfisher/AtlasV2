import { config } from '../config.js';
import { logTo } from '../log.js';
import type { ChatMessage } from './client.js';
import {
  cloudReady,
  completeJson as cloudCompleteJson,
  completeJsonOffice as cloudCompleteJsonOffice,
  completeText as cloudCompleteText,
} from '../providers/dispatch.js';

export interface JsonCallOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** target llama-server port (defaults to the chat process) */
  port?: number;
  /** live progress: called with each content delta as the model writes */
  onDelta?: (delta: string) => void;
}

async function complete(
  body: Record<string, unknown>,
  opts: JsonCallOptions,
  label: string,
): Promise<string> {
  const url = `http://127.0.0.1:${opts.port ?? config.llamaServer.chatPort}/v1/chat/completions`;
  if (opts.onDelta) {
    // stream so callers can show the document being written live
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal ?? null,
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`llama-server responded ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            opts.onDelta(delta);
          }
        } catch {
          // skip malformed frames
        }
      }
    }
    if (!content) logTo('pipeline', `${label}(stream) produced empty content`);
    return content;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal ?? null,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`llama-server responded ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string };
      finish_reason?: string;
    }>;
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? '';
  if (!content) {
    logTo(
      'pipeline',
      `${label} empty content: finish=${choice?.finish_reason} reasoning_len=${choice?.message?.reasoning_content?.length ?? 0}`,
    );
  }
  return content;
}

/**
 * Constrained-JSON completion against the local llama-server (response_format
 * json_schema → GBNF). Returns the raw content string — callers parse +
 * ajv-validate so first-pass validity is measurable. Streams when onDelta set.
 */
export function completeJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: JsonCallOptions = {},
): Promise<string> {
  if (cloudReady()) {
    return cloudCompleteJson(messages, schema, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      onDelta: opts.onDelta,
    });
  }
  return complete(
    {
      messages,
      response_format: { type: 'json_schema', json_schema: { schema } },
      temperature: opts.temperature ?? 0.2,
      top_p: 0.95,
      top_k: 64,
      max_tokens: opts.maxTokens ?? 3072,
      chat_template_kwargs: { enable_thinking: false },
    },
    opts,
    'completeJson',
  );
}

/** Document/artifact generation: on the cloud path it forces a Claude model and
 * plain streaming (see dispatch.completeJsonOffice). Local llama is a single
 * model with no gating, so it falls back to the same constrained call as
 * completeJson. Use this for every generateJson skill; use completeJson for
 * router/memory/classification calls that must stay on the selected model. */
export function completeJsonOffice(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: JsonCallOptions = {},
): Promise<string> {
  if (cloudReady()) {
    return cloudCompleteJsonOffice(messages, schema, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      onDelta: opts.onDelta,
    }).result;
  }
  return complete(
    {
      messages,
      response_format: { type: 'json_schema', json_schema: { schema } },
      temperature: opts.temperature ?? 0.2,
      top_p: 0.95,
      top_k: 64,
      max_tokens: opts.maxTokens ?? 3072,
      chat_template_kwargs: { enable_thinking: false },
    },
    opts,
    'completeJsonOffice',
  );
}

/** Plain completion (mermaid/svg/md emission, summaries). Streams when onDelta set. */
export function completeText(
  messages: ChatMessage[],
  opts: JsonCallOptions = {},
): Promise<string> {
  if (cloudReady()) {
    return cloudCompleteText(messages, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      onDelta: opts.onDelta,
    });
  }
  return complete(
    {
      messages,
      temperature: opts.temperature ?? 0.7,
      top_p: 0.95,
      top_k: 64,
      max_tokens: opts.maxTokens ?? 2048,
      chat_template_kwargs: { enable_thinking: false },
    },
    opts,
    'completeText',
  );
}
