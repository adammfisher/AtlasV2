import { config } from '../config.js';

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * Gemma thinks before answering (reasoning_content frames) — open-ended prompts
   * can think for 10s+. Chat keeps this off for fast first tokens; office tasks may
   * opt in later (Stage 3+).
   */
  thinking?: boolean;
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
      chat_template_kwargs: { enable_thinking: opts.thinking ?? false },
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
