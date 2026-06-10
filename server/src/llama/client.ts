import { config } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Stream a chat completion from the local llama-server, yielding content deltas. */
export async function* streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string> {
  const res = await fetch(`http://127.0.0.1:${config.llamaServer.chatPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal ?? null,
    body: JSON.stringify({
      messages,
      stream: true,
      temperature: opts.temperature ?? 1.0,
      top_p: 0.95,
      top_k: 64,
      max_tokens: opts.maxTokens ?? 1024,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`llama-server responded ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore malformed keep-alive lines
      }
    }
  }
}
