/**
 * Conversation-keyed stream store (FIXLOG FX-2/FX-3/FX-5).
 *
 * The SSE consumer used to live inside ChatView: stream lifetime was tied to
 * component lifetime, ANY connection close was treated as success, and every
 * chunk forced a synchronous React re-render. Consequences: a dropped stream
 * silently discarded the in-progress exchange (in a new chat that collapses
 * the view to the empty "home" state — the Priority-Zero bug), navigating
 * away orphaned the stream, and long generations janked the main thread.
 *
 * This store owns the stream instead:
 *  - keyed by conversation id, independent of React mount state;
 *  - completion is keyed on the server's terminal `done {messageId}` event —
 *    a close WITHOUT `done` is a connection loss, surfaced in place as an
 *    error with retry (never a silent reset);
 *  - the live exchange is cleared only after the refetched conversation
 *    actually contains the persisted assistant message (messageId match), so
 *    content never vanishes before its durable copy is on screen;
 *  - subscriber notifications are coalesced to animation frames, so a
 *    thousand-delta stream costs at most one render per frame.
 */
import { queryClient } from './store';
import { postSse } from './sse';
import type { ArtifactRef, Citation, Message, PipelineStep } from './api';

export interface StreamCallbacks {
  /** live document text for the LivePanel (null = close panel). */
  onGenStream: (text: string | null, label: string) => void;
  onArtifactReady: (ref: ArtifactRef) => void;
}

export interface LiveExchange {
  convId: string;
  toolChips: Array<{ tool: string; connector: string }>;
  userAttachments?: Array<{ id: string; name: string; kind: string }>;
  userText: string;
  assistantText: string;
  citations?: Citation[];
  thinkingText?: string;
  started: boolean;
  error: string | null;
  pipeline: boolean;
  skillBadge?: string;
  steps: PipelineStep[];
  artifact?: ArtifactRef;
  summary?: string;
  /** terminal `done` event arrived (stream completed successfully). */
  done: boolean;
  messageId?: string;
  /** stream ended one way or another — composer unlocks when true. */
  finished: boolean;
  /** stream closed without `done` and without a user abort. */
  connectionLost: boolean;
}

interface StreamEntry {
  live: LiveExchange;
  controller: AbortController;
  callbacks: StreamCallbacks;
  gen: { text: string | null; label: string };
  abortedByUser: boolean;
}

const streams = new Map<string, StreamEntry>();
const listeners = new Set<() => void>();

/* ---- rAF-coalesced notifications (FX-5 jank) ---- */
let scheduled = false;
function notify(): void {
  if (scheduled) return;
  scheduled = true;
  const flush = (): void => {
    scheduled = false;
    for (const l of listeners) l();
  };
  if (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible') {
    requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 16);
  }
}

export function subscribeStreams(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLive(convId: string | null): LiveExchange | null {
  if (!convId) return null;
  return streams.get(convId)?.live ?? null;
}

export function isBusy(convId: string | null): boolean {
  const live = getLive(convId);
  return live !== null && !live.finished;
}

function update(convId: string, patch: Partial<LiveExchange>): void {
  const entry = streams.get(convId);
  if (!entry) return;
  entry.live = { ...entry.live, ...patch };
  notify();
}

function upsertStep(steps: PipelineStep[], step: PipelineStep): PipelineStep[] {
  const i = steps.findIndex((s) => s.label === step.label);
  if (i >= 0) {
    const next = steps.slice();
    next[i] = step;
    return next;
  }
  return [...steps, step];
}

export function stopStream(convId: string): void {
  const entry = streams.get(convId);
  if (!entry) return;
  entry.abortedByUser = true;
  entry.controller.abort();
}

/** Clear a finished/errored exchange (retry buttons, post-persist cleanup). */
export function clearStream(convId: string): void {
  streams.delete(convId);
  notify();
}

/** After `done`, drop the live copy only once the durable copy is visible. */
function clearWhenPersisted(convId: string, messageId: string | undefined): void {
  void queryClient.invalidateQueries({ queryKey: ['conversation', convId] }).then(() => {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    const conv = queryClient.getQueryData<{ messages?: Message[] }>(['conversation', convId]);
    const persisted =
      conv?.messages?.some((m) => (messageId ? m.id === messageId : false)) ??
      false;
    if (persisted) {
      clearStream(convId);
    } else {
      // durable copy not visible (query inactive or persistence lagging):
      // keep the live exchange rendered — never collapse to an empty view.
      update(convId, { finished: true });
    }
  });
}

export function startStream(
  convId: string,
  body: { text: string; attachments: Array<{ id: string; name: string; kind: string }>; retry: boolean; thinking: boolean },
  callbacks: StreamCallbacks,
): void {
  if (isBusy(convId)) return;
  const controller = new AbortController();
  const entry: StreamEntry = {
    controller,
    callbacks,
    abortedByUser: false,
    gen: { text: null, label: '' },
    live: {
      convId,
      toolChips: [],
      userText: body.retry ? '' : body.text,
      userAttachments: body.attachments,
      assistantText: '',
      started: false,
      error: null,
      pipeline: false,
      steps: [],
      done: false,
      finished: false,
      connectionLost: false,
    },
  };
  streams.set(convId, entry);
  notify();

  void postSse(`/conversations/${convId}/messages`, body, {
    onEvent: (event, data) => {
      if (event === 'token') {
        const delta = typeof data.delta === 'string' ? data.delta : '';
        const live = entry.live;
        entry.live = { ...live, started: true, assistantText: live.assistantText + delta };
        notify();
      } else if (event === 'step') {
        update(convId, { pipeline: true, steps: upsertStep(entry.live.steps, data as unknown as PipelineStep) });
      } else if (event === 'route') {
        if ((data as { intent?: string }).intent === 'chat') update(convId, { pipeline: false, steps: [] });
      } else if (event === 'pipeline') {
        const d = data as { phase?: string; skillBadge?: string };
        if (d.phase === 'start') update(convId, { pipeline: true, skillBadge: d.skillBadge });
      } else if (event === 'artifact') {
        const ref = data as unknown as ArtifactRef;
        update(convId, { artifact: ref });
        entry.gen = { text: null, label: entry.gen.label };
        entry.callbacks.onGenStream(null, entry.gen.label);
        entry.callbacks.onArtifactReady(ref);
      } else if (event === 'tool') {
        const chip = data as { tool: string; connector: string };
        update(convId, { toolChips: [...entry.live.toolChips, chip] });
      } else if (event === 'gen') {
        const d = data as { reset?: boolean; delta?: string; label?: string };
        if (d.reset) {
          entry.gen = { text: '', label: d.label ?? entry.gen.label };
        } else if (d.delta && entry.gen.text !== null) {
          entry.gen = { ...entry.gen, text: entry.gen.text + d.delta };
        }
        entry.callbacks.onGenStream(entry.gen.text, entry.gen.label);
      } else if (event === 'thinking') {
        const delta = typeof data.delta === 'string' ? data.delta : '';
        update(convId, { thinkingText: (entry.live.thinkingText ?? '') + delta });
      } else if (event === 'citations') {
        const d = data as { text?: string; citations?: Citation[] };
        update(convId, { assistantText: d.text ?? entry.live.assistantText, citations: d.citations ?? [] });
      } else if (event === 'assistant_text') {
        update(convId, { summary: (data as { text?: string }).text ?? '' });
      } else if (event === 'error') {
        const message = typeof data.message === 'string' ? data.message : 'Unknown error';
        update(convId, { error: message });
      } else if (event === 'done') {
        update(convId, { done: true, messageId: (data as { messageId?: string }).messageId });
      }
    },
    onClose: () => {
      entry.callbacks.onGenStream(null, entry.gen.label);
      const live = entry.live;
      if (live.done) {
        // genuine completion: hand off to the durable copy, then clear
        clearWhenPersisted(convId, live.messageId);
        return;
      }
      if (entry.abortedByUser) {
        // user pressed stop: the server persists the partial — refetch and drop
        void queryClient.invalidateQueries({ queryKey: ['conversation', convId] }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          clearStream(convId);
        });
        return;
      }
      if (live.error) {
        // server-reported error: keep it on screen, unlock the composer
        update(convId, { finished: true });
        void queryClient.invalidateQueries({ queryKey: ['conversation', convId] });
        return;
      }
      // closed with no done, no abort, no error: CONNECTION LOST. Surface in
      // place — the generation may still be running server-side. Never reset.
      update(convId, {
        finished: true,
        connectionLost: true,
        error: 'Connection lost — the response may still be generating. Retry, or it will appear on reload once it completes.',
      });
      void queryClient.invalidateQueries({ queryKey: ['conversation', convId] });
    },
    onError: (message) => {
      // fetch-level failure before/while streaming
      update(convId, { error: message, finished: true });
    },
  }, controller.signal);
}
