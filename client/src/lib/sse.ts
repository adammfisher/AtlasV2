export interface SseHandlers {
  onEvent: (event: string, data: Record<string, unknown>) => void;
  /** the connection ended (cleanly or not). Terminal-success is signalled by
   * the server's `done` event, NOT by this callback — a close without `done`
   * is a connection loss (see lib/stream.ts). */
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
  const token = localStorage.getItem('atlas_token');
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      // mid-stream network failure: read() rejects. Without this catch the
      // promise rejected unhandled and the consumer hung busy forever (FX-2).
      // Treat it as a close-without-done — the store surfaces connection loss.
      handlers.onClose();
      return;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
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
