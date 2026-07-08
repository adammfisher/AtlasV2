/**
 * OpenAI API provider (Chat Completions). Mirrors the Bedrock provider's three
 * inference entry points so a config model with provider:"openai" runs chat
 * (streaming + tool loop), structured JSON, and plain text. Activated only when
 * the model's keyEnv is set. Never imported unless an openai model is selected.
 */
import { activeModelDef } from './bedrock.js';
import type { ChatMessage } from '../llama/client.js';
import type { BedrockTool } from './bedrock.js';
import { logTo } from '../log.js';

function auth(): { key: string; model: string; base: string } {
  const def = activeModelDef();
  const key = def.keyEnv ? process.env[def.keyEnv] : undefined;
  if (!key) throw new Error(`OpenAI API key not set (${def.keyEnv ?? 'keyEnv missing'})`);
  return { key, model: def.model, base: def.baseUrl || 'https://api.openai.com/v1' };
}

function toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const { key, base } = auth();
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });
}

/** Streaming chat with a tool loop (function calling). Yields text deltas. */
export async function* streamWithTools(
  messages: ChatMessage[],
  tools: BedrockTool[],
  execute: (name: string, input: Record<string, unknown>) => Promise<string>,
  onTool: (name: string) => void,
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const { model } = auth();
  const convo = toOpenAIMessages(messages);
  const oaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.schema },
  }));

  for (let iter = 0; iter < 3; iter++) {
    const res = await post(
      '/chat/completions',
      {
        model,
        messages: convo,
        stream: true,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
        ...(oaiTools.length ? { tools: oaiTools, tool_choice: 'auto' } : {}),
      },
      opts.signal,
    );
    if (!res.ok || !res.body) {
      throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const toolCalls: Array<{ id: string; name: string; args: string }> = [];
    let finish = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const d = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
              finish_reason?: string;
            }>;
          };
          const ch = d.choices?.[0];
          if (!ch) continue;
          if (ch.delta?.content) yield ch.delta.content;
          for (const tc of ch.delta?.tool_calls ?? []) {
            const slot = (toolCalls[tc.index] ??= { id: '', name: '', args: '' });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
          if (ch.finish_reason) finish = ch.finish_reason;
        } catch {
          /* keep-alive / partial */
        }
      }
    }
    if (finish !== 'tool_calls' || toolCalls.length === 0) return;

    // execute tools, append the assistant turn + tool results, loop
    convo.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args || '{}' } })),
    });
    for (const t of toolCalls) {
      onTool(t.name);
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(t.args || '{}') as Record<string, unknown>;
      } catch {
        /* leave empty */
      }
      const result = await execute(t.name, input).catch((e: Error) => `tool error: ${e.message}`);
      convo.push({ role: 'tool', tool_call_id: t.id, content: result });
    }
  }
}

/** Structured JSON via response_format json_schema (with a plain-JSON fallback). */
export async function completeJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal; onDelta?: (d: string) => void } = {},
): Promise<string> {
  const { model } = auth();
  const body = {
    model,
    messages: toOpenAIMessages(messages),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 4096,
    response_format: { type: 'json_schema', json_schema: { name: 'payload', schema, strict: false } },
  };
  let res = await post('/chat/completions', body, opts.signal);
  if (!res.ok) {
    // some models/keys reject json_schema — fall back to json_object
    logTo('app', `openai json_schema rejected (${res.status}) — retrying json_object`);
    res = await post('/chat/completions', { ...body, response_format: { type: 'json_object' } }, opts.signal);
  }
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = d.choices?.[0]?.message?.content ?? '';
  if (opts.onDelta && content) opts.onDelta(content);
  return content;
}

export async function completeText(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { model } = auth();
  const res = await post(
    '/chat/completions',
    { model, messages: toOpenAIMessages(messages), temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 2048 },
    opts.signal,
  );
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return d.choices?.[0]?.message?.content ?? '';
}
