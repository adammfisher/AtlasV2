/**
 * Anthropic API provider (Messages). Mirrors the Bedrock provider's three
 * inference entry points for config models with provider:"anthropic". Uses
 * native tool use for both the chat loop and structured JSON. Activated only
 * when the model's keyEnv is set.
 */
import { activeModelDef } from './bedrock.js';
import type { ChatMessage } from '../llama/client.js';
import type { BedrockTool } from './bedrock.js';

function auth(): { key: string; model: string; base: string } {
  const def = activeModelDef();
  const key = def.keyEnv ? process.env[def.keyEnv] : undefined;
  if (!key) throw new Error(`Anthropic API key not set (${def.keyEnv ?? 'keyEnv missing'})`);
  return { key, model: def.model, base: def.baseUrl || 'https://api.anthropic.com/v1' };
}

/** Split the ChatMessage list into a system string + user/assistant turns. */
function split(messages: ChatMessage[]): { system: string; msgs: Array<{ role: string; content: unknown }> } {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const msgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  return { system, msgs };
}

async function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  const { key, base } = auth();
  return fetch(`${base}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function* streamWithTools(
  messages: ChatMessage[],
  tools: BedrockTool[],
  execute: (name: string, input: Record<string, unknown>) => Promise<string>,
  onTool: (name: string) => void,
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const { model } = auth();
  const { system, msgs } = split(messages);
  const aTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));

  const MAX_TOOL_ROUNDS = 6;
  for (let iter = 0; iter <= MAX_TOOL_ROUNDS; iter++) {
    const offerTools = iter < MAX_TOOL_ROUNDS && aTools.length > 0;
    const res = await post(
      {
        model,
        system: system || undefined,
        messages: msgs,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
        stream: true,
        ...(offerTools ? { tools: aTools } : {}),
      },
      opts.signal,
    );
    if (!res.ok || !res.body) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const blocks: Array<{ type: string; name?: string; id?: string; json: string }> = [];
    let stopReason = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        try {
          const d = JSON.parse(s.slice(5).trim()) as {
            type?: string;
            index?: number;
            content_block?: { type?: string; name?: string; id?: string };
            delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
          };
          if (d.type === 'content_block_start' && d.content_block) {
            blocks[d.index ?? blocks.length] = { type: d.content_block.type ?? '', name: d.content_block.name, id: d.content_block.id, json: '' };
          } else if (d.type === 'content_block_delta' && d.delta) {
            if (d.delta.type === 'text_delta' && d.delta.text) yield d.delta.text;
            if (d.delta.type === 'input_json_delta' && d.delta.partial_json) {
              const b = blocks[d.index ?? 0];
              if (b) b.json += d.delta.partial_json;
            }
          } else if (d.type === 'message_delta' && d.delta?.stop_reason) {
            stopReason = d.delta.stop_reason;
          }
        } catch {
          /* keep-alive */
        }
      }
    }
    const toolUses = blocks.filter((b) => b && b.type === 'tool_use');
    if (!offerTools || stopReason !== 'tool_use' || toolUses.length === 0) return;

    // append assistant tool_use turn + tool_result turn, loop
    msgs.push({
      role: 'assistant',
      content: toolUses.map((b) => ({ type: 'tool_use', id: b.id, name: b.name, input: safeParse(b.json) })),
    });
    const results: unknown[] = [];
    for (const b of toolUses) {
      onTool(b.name ?? 'tool');
      const out = await execute(b.name ?? '', safeParse(b.json)).catch((e: Error) => `tool error: ${e.message}`);
      results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
    }
    msgs.push({ role: 'user', content: results });
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Structured JSON via forced tool use (an "emit" tool). */
export async function completeJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal; onDelta?: (d: string) => void } = {},
): Promise<string> {
  const { model } = auth();
  const { system, msgs } = split(messages);
  const res = await post(
    {
      model,
      system: system || undefined,
      messages: msgs,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
      tools: [{ name: 'emit', description: 'Emit the document payload.', input_schema: schema }],
      tool_choice: { type: 'tool', name: 'emit' },
    },
    opts.signal,
  );
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const d = (await res.json()) as { content?: Array<{ type?: string; input?: unknown }> };
  const tool = d.content?.find((c) => c.type === 'tool_use');
  const content = tool ? JSON.stringify(tool.input ?? {}) : '';
  if (opts.onDelta && content) opts.onDelta(content);
  return content;
}

export async function completeText(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { model } = auth();
  const { system, msgs } = split(messages);
  const res = await post(
    { model, system: system || undefined, messages: msgs, max_tokens: opts.maxTokens ?? 2048, temperature: opts.temperature ?? 0.4 },
    opts.signal,
  );
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const d = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  return (d.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}
