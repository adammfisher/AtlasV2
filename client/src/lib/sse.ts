export interface SseHandlers {
  onEvent: (event: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

/** POST a message and consume the text/event-stream response (named events per PRD §4). */
export async function postSse(
  path: string,
  body: unknown,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : String(err));
    return;
  }
  if (!res.ok || !res.body) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    handlers.onError(errBody.error ?? `${res.status} ${res.statusText}`);
    return;
  }

  const reader = res.body.getReader();
  signal?.addEventListener('abort', () => void reader.cancel().catch(() => undefined));
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventName = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          handlers.onEvent(eventName, JSON.parse(line.slice(6)) as Record<string, unknown>);
        } catch {
          // skip malformed frames
        }
      }
    }
  }
  handlers.onClose();
}
