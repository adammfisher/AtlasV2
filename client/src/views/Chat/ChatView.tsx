import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Lock,
  Loader2,
  Plus,
  Paperclip,
  ArrowUp,
  Cpu,
  Cloud,
  AlertTriangle,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, SERIF } from '../../theme/tokens';
import { api, type ModelsRegistry, type Message, type ArtifactRef } from '../../lib/api';
import { postSse } from '../../lib/sse';
import { ModelMenu } from '../../components/ModelMenu';
import { PipelineMessage } from '../../components/PipelineMessage';

const SUGGESTIONS = [
  'Build a QBR deck from the Q3 pipeline numbers',
  'Redline section 7 of the Meridian MSA',
  'Forecast model for next quarter’s pipeline',
  'Diagram the org-intel ingest flow',
  'Landing page prototype for Atlas',
];

interface LiveExchange {
  userText: string;
  assistantText: string;
  started: boolean;
  error: string | null;
}

export function ChatView({
  convId,
  registry,
  llamaStatus,
  llamaError,
  userName,
  activeProjectName,
  openBedrock,
  onOpenArtifact,
}: {
  convId: string | null;
  registry: ModelsRegistry | undefined;
  llamaStatus: string;
  llamaError: string | null;
  userName: string;
  activeProjectName: string;
  openBedrock: () => void;
  onOpenArtifact: (a: ArtifactRef) => void;
}) {
  const [input, setInput] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [live, setLive] = useState<LiveExchange | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: conv } = useQuery({
    queryKey: ['conversation', convId],
    queryFn: () => api.conversation(convId as string),
    enabled: convId !== null,
  });

  const messages: Message[] = conv?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, live?.assistantText]);

  const busy = live !== null;

  const send = () => {
    const text = input.trim();
    if (!text || busy || convId === null) return;
    setInput('');
    setLive({ userText: text, assistantText: '', started: false, error: null });
    void postSse(`/conversations/${convId}/messages`, { text }, {
      onEvent: (event, data) => {
        if (event === 'token') {
          const delta = typeof data.delta === 'string' ? data.delta : '';
          setLive((l) => (l ? { ...l, started: true, assistantText: l.assistantText + delta } : l));
        } else if (event === 'error') {
          const message = typeof data.message === 'string' ? data.message : 'Unknown error';
          setLive((l) => (l ? { ...l, error: message } : l));
        }
      },
      onClose: () => {
        void queryClient.invalidateQueries({ queryKey: ['conversation', convId] }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          setLive((l) => (l?.error ? l : null));
        });
      },
      onError: (message) => {
        setLive((l) => (l ? { ...l, error: message } : l));
      },
    });
  };

  const routerModel = registry?.models.find((m) => m.id === 'e2b')?.present ? 'E2B' : 'E4B';
  const selected = registry?.models.find((m) => m.id === registry.selected);
  const pillLabel = selected?.name ?? 'Gemma 4 E4B';
  const empty = messages.length === 0 && live === null;
  const offline = llamaStatus !== 'ready';

  return (
    <div className="flex flex-col h-full min-w-0">
      <div
        className="flex items-center gap-2 px-6 py-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${C.borderSoft}` }}
      >
        <span className="text-sm flex-shrink-0" style={{ color: C.dim }}>
          {activeProjectName}
        </span>
        <ChevronRight size={14} className="flex-shrink-0" style={{ color: C.faint }} />
        <span className="text-sm truncate" style={{ color: C.text }}>
          {conv?.title ?? 'New chat'}
        </span>
        <span
          className="ml-auto inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ background: C.greenDim, color: C.green }}
        >
          <Lock size={11} /> Local — nothing leaves this machine
        </span>
      </div>

      {offline && (
        <div
          className="flex items-center gap-2 px-6 py-2 text-xs flex-shrink-0"
          style={{ background: C.amberDim, color: C.amber, borderBottom: `1px solid ${C.borderSoft}` }}
        >
          {llamaStatus === 'error' ? (
            <AlertTriangle size={13} />
          ) : (
            <Loader2 size={13} className="animate-spin" />
          )}
          {llamaStatus === 'error'
            ? `Local model offline — ${llamaError ?? 'llama-server crashed'}`
            : llamaStatus === 'restarting'
              ? 'Local model crashed — restarting llama-server…'
              : 'Local model starting — loading weights…'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center px-6">
            <div className="text-2xl mb-1" style={{ color: C.text, fontFamily: SERIF }}>
              What are we building, {userName}?
            </div>
            <div className="text-sm mb-6" style={{ color: C.faint }}>
              Documents, decks, models, diagrams, and prototypes — all on this machine.
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs px-3 py-2 rounded-full transition-colors"
                  style={{ background: C.raise, color: C.dim, border: `1px solid ${C.borderSoft}` }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div
                    className="rounded-2xl px-4 py-3 text-sm max-w-md"
                    style={{ background: C.raise, color: C.text }}
                  >
                    {m.kind === 'text' ? m.text : ''}
                  </div>
                </div>
              ) : m.kind === 'pipeline' ? (
                <PipelineMessage
                  key={m.id}
                  m={m}
                  routerLabel={routerModel}
                  onOpenArtifact={() => m.artifact && onOpenArtifact(m.artifact)}
                />
              ) : (
                <div key={m.id}>
                  <p
                    className="text-base leading-relaxed whitespace-pre-wrap"
                    style={{ color: C.text, fontFamily: SERIF }}
                  >
                    {m.text}
                  </p>
                </div>
              ),
            )}
            {live && (
              <>
                <div className="flex justify-end">
                  <div
                    className="rounded-2xl px-4 py-3 text-sm max-w-md"
                    style={{ background: C.raise, color: C.text }}
                  >
                    {live.userText}
                  </div>
                </div>
                <div>
                  {live.error ? (
                    <div
                      className="flex items-start gap-2 text-sm rounded-xl px-3.5 py-3"
                      style={{ background: C.amberDim, color: C.amber }}
                    >
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{live.error}</span>
                    </div>
                  ) : !live.started ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: C.dim }}>
                      <Loader2 size={14} className="animate-spin" style={{ color: C.accent }} />
                      Thinking…
                    </div>
                  ) : (
                    <p
                      className="text-base leading-relaxed whitespace-pre-wrap"
                      style={{ color: C.text, fontFamily: SERIF }}
                    >
                      {live.assistantText}
                    </p>
                  )}
                </div>
              </>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-6 pb-5 pt-2">
        <div className="max-w-2xl mx-auto relative">
          {menuOpen && registry && (
            <ModelMenu
              registry={registry}
              onSelect={(id) => {
                void api.selectModel(id).then(() => {
                  void queryClient.invalidateQueries({ queryKey: ['models'] });
                });
              }}
              openBedrock={openBedrock}
              close={() => setMenuOpen(false)}
            />
          )}
          <div
            className="rounded-2xl px-4 pt-3 pb-2.5"
            style={{ background: C.raise, border: `1px solid ${C.border}` }}
          >
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Message Atlas…"
              className="w-full bg-transparent outline-none resize-none text-sm"
              style={{ color: C.text }}
            />
            <div className="flex items-center gap-2 mt-2">
              <Plus size={17} style={{ color: C.dim }} className="cursor-pointer" />
              <span title="File uploads post-v1" className="cursor-not-allowed">
                <Paperclip size={15} style={{ color: C.faint }} />
              </span>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                style={{ color: C.dim, background: C.bg }}
              >
                {registry?.bedrock.connected ? (
                  <Cloud size={12} style={{ color: C.blue }} />
                ) : (
                  <Cpu size={12} style={{ color: C.green }} />
                )}
                {pillLabel}
                <ChevronDown size={12} />
              </button>
              <button
                onClick={send}
                disabled={busy}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: C.accent, opacity: busy ? 0.5 : 1 }}
              >
                {busy ? (
                  <Loader2 size={15} color="#fff" className="animate-spin" />
                ) : (
                  <ArrowUp size={16} color="#fff" />
                )}
              </button>
            </div>
          </div>
          <div className="text-center text-xs mt-2" style={{ color: C.faint }}>
            Atlas runs entirely on this machine. Generated documents are validated before delivery.
          </div>
        </div>
      </div>
    </div>
  );
}
