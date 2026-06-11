import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Lock,
  Loader2,
  Paperclip,
  Sparkles,
  Mic,
  ArrowUp,
  Zap,
  FolderKanban,
  AlertCircle,
  Box,
  Cog,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, sans, serif } from '../../theme/tokens';
import {
  api,
  type ModelsRegistry,
  type Message,
  type ArtifactRef,
  type PipelineMessageData,
  type PipelineStep,
} from '../../lib/api';
import { postSse } from '../../lib/sse';
import { Badge } from '../../components/Badge';
import { ModelMenu } from '../../components/ModelMenu';
import { BedrockModal } from '../../components/BedrockModal';
import { StepRow } from '../../components/StepRow';
import { ArtifactCard } from '../../components/ArtifactCard';
import { ArtifactPreview } from '../../components/ArtifactPreview';
import { conversationArtifacts } from '../../components/ArtifactDrawer';

const SUGGESTIONS = [
  'Build a QBR deck from the Q3 pipeline numbers',
  'Redline section 4.2 of the MSA',
  'Forecast model for next quarter’s pipeline',
  'Diagram the org-intel ingest flow',
  'Landing page prototype for Atlas',
  'Define a product — auto loan payment calculator',
];

/** kinds whose preview renders inline in the chat thread (A18/A19) */
const INLINE_PREVIEW_KINDS = ['mermaid', 'react', 'site', 'svg', 'md'];

function Msg({ who, children }: { who: 'user' | 'assistant'; children: ReactNode }) {
  if (who === 'user') {
    return (
      <div className="flex justify-end mb-5">
        <div
          className="rounded-2xl px-4 py-2.5 max-w-md text-sm leading-relaxed"
          style={{ background: C.panel, color: C.text, fontFamily: sans, border: `1px solid ${C.borderSoft}` }}
        >
          {children}
        </div>
      </div>
    );
  }
  return <div className="mb-6 max-w-2xl">{children}</div>;
}

function ToolChips({ chips }: { chips: Array<{ tool: string; connector: string }> }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {chips.map((c, i) => (
        <span
          key={`${c.tool}-${i}`}
          className="inline-flex items-center gap-1 text-xs rounded-md px-2 py-0.5"
          style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, color: C.mute, fontFamily: sans }}
        >
          <Cog size={11} /> {c.tool} · {c.connector}
        </span>
      ))}
    </div>
  );
}

function PipelineCard({ m }: { m: PipelineMessageData }) {
  if (m.edit) {
    return (
      <div className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
        {m.steps.map((s) => (
          <StepRow key={s.label} state={s.state} label={s.label} detail={s.detail} />
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-xl px-3.5 py-3 mb-3" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Zap size={13} style={{ color: C.accent }} />
        <span className="text-xs font-medium" style={{ color: C.text, fontFamily: sans }}>
          Document pipeline
        </span>
        {m.skillBadge ? (
          <Badge color={C.accent} dim={C.accentDim}>
            {m.skillBadge}
          </Badge>
        ) : null}
        {m.duration ? (
          <span className="text-xs ml-auto" style={{ color: C.mute, fontFamily: sans }}>
            {m.duration}
          </span>
        ) : null}
      </div>
      {m.steps.map((s) => (
        <StepRow key={s.label} state={s.state} label={s.label} detail={s.detail} />
      ))}
    </div>
  );
}

interface LiveExchange {
  toolChips: Array<{ tool: string; connector: string }>;
  userText: string;
  assistantText: string;
  started: boolean;
  error: string | null;
  /** live pipeline state — set when the router picks a document skill */
  pipeline: boolean;
  skillBadge?: string;
  steps: PipelineStep[];
  artifact?: ArtifactRef;
  summary?: string;
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

export function ChatView({
  convId,
  registry,
  llamaStatus,
  llamaError,
  userName,
  activeProjectName,
  onOpenArtifact,
  onOpenArtifactList,
  onGenStream,
  onArtifactReady,
}: {
  convId: string | null;
  registry: ModelsRegistry | undefined;
  llamaStatus: string;
  llamaError: string | null;
  userName: string;
  activeProjectName: string;
  onOpenArtifact: (a: ArtifactRef) => void;
  onOpenArtifactList: () => void;
  onGenStream: (text: string | null, label: string) => void;
  onArtifactReady: (a: ArtifactRef) => void;
}) {
  const [input, setInput] = useState('');
  const [menu, setMenu] = useState(false);
  const [live, setLive] = useState<LiveExchange | null>(null);
  const [bedrockModal, setBedrockModal] = useState(false);
  const genRef = useRef<{ text: string | null; label: string }>({ text: null, label: '' });
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
    setLive({ toolChips: [], userText: text, assistantText: '', started: false, error: null, pipeline: false, steps: [] });
    void postSse(`/conversations/${convId}/messages`, { text }, {
      onEvent: (event, data) => {
        if (event === 'token') {
          const delta = typeof data.delta === 'string' ? data.delta : '';
          setLive((l) => (l ? { ...l, started: true, assistantText: l.assistantText + delta } : l));
        } else if (event === 'step') {
          setLive((l) =>
            l ? { ...l, pipeline: true, steps: upsertStep(l.steps, data as unknown as PipelineStep) } : l,
          );
        } else if (event === 'route') {
          // plain chat: drop the transient router row, fall back to Thinking…
          if ((data as { intent?: string }).intent === 'chat') {
            setLive((l) => (l ? { ...l, pipeline: false, steps: [] } : l));
          }
        } else if (event === 'pipeline') {
          const d = data as { phase?: string; skillBadge?: string };
          if (d.phase === 'start') {
            setLive((l) => (l ? { ...l, pipeline: true, skillBadge: d.skillBadge } : l));
          }
        } else if (event === 'artifact') {
          const ref = data as unknown as ArtifactRef;
          setLive((l) => (l ? { ...l, artifact: ref } : l));
          genRef.current = { text: null, label: genRef.current.label };
          onGenStream(null, genRef.current.label);
          onArtifactReady(ref);
        } else if (event === 'tool') {
          const chip = data as { tool: string; connector: string };
          setLive((l) => (l ? { ...l, toolChips: [...l.toolChips, chip] } : l));
        } else if (event === 'gen') {
          const d = data as { reset?: boolean; delta?: string; label?: string };
          if (d.reset) {
            genRef.current = { text: '', label: d.label ?? genRef.current.label };
          } else if (d.delta && genRef.current.text !== null) {
            genRef.current = { ...genRef.current, text: genRef.current.text + d.delta };
          }
          onGenStream(genRef.current.text, genRef.current.label);
        } else if (event === 'assistant_text') {
          setLive((l) => (l ? { ...l, summary: (data as { text?: string }).text ?? '' } : l));
        } else if (event === 'error') {
          const message = typeof data.message === 'string' ? data.message : 'Unknown error';
          setLive((l) => (l ? { ...l, error: message } : l));
        }
      },
      onClose: () => {
        onGenStream(null, genRef.current.label);
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

  const selectedRow =
    registry?.selected === 'auto'
      ? { name: 'Auto' }
      : registry?.models.find((m) => m.id === registry.selected) ?? { name: 'Auto' };
  const empty = messages.length === 0 && live === null;
  const offline = llamaStatus !== 'ready';
  const artifactCount = conversationArtifacts(messages).length + (live?.artifact?.artifactId && !messages.some((m) => m.kind === 'pipeline' && m.artifact?.artifactId === live.artifact?.artifactId) ? 1 : 0);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <span className="text-sm" style={{ color: C.mute, fontFamily: sans }}>
          {activeProjectName}
        </span>
        <ChevronRight size={13} style={{ color: C.mute }} />
        <span className="text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>
          {conv?.title ?? 'New chat'}
        </span>
        <Badge color={C.purple} dim={C.purpleDim} icon={FolderKanban}>
          Project
        </Badge>
        <span className="ml-auto" />
        <button
          onClick={onOpenArtifactList}
          title="Artifacts in this chat"
          className="relative flex items-center justify-center p-1.5 rounded-lg transition-colors"
          style={{ color: artifactCount > 0 ? C.text : C.mute }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Box size={16} />
          {artifactCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-[10px] font-semibold"
              style={{ minWidth: 14, height: 14, padding: '0 3px', background: C.accent, color: '#fff', fontFamily: sans }}
            >
              {artifactCount}
            </span>
          )}
        </button>
        <Badge color={C.green} dim={C.greenDim} icon={Lock}>
          On-device · no data leaves this machine
        </Badge>
      </div>

      {offline && (
        <div
          className="flex items-center gap-2 px-5 py-2 text-xs"
          style={{ background: C.amberDim, color: C.amber, borderBottom: `1px solid ${C.borderSoft}`, fontFamily: sans }}
        >
          {llamaStatus === 'error' ? <AlertCircle size={13} /> : <Loader2 size={13} className="animate-spin" />}
          {llamaStatus === 'error'
            ? `Local model offline — ${llamaError ?? 'llama-server crashed'}`
            : llamaStatus === 'restarting'
              ? 'Local model crashed — restarting llama-server…'
              : 'Local model starting — loading weights…'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="mb-1" style={{ color: C.text, fontFamily: serif, fontSize: 26 }}>
              What are we building, {userName}?
            </div>
            <div className="text-sm mb-6" style={{ color: C.mute, fontFamily: sans }}>
              Documents, decks, models, diagrams, and prototypes — all on this machine.
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs px-3 py-2 rounded-full transition-colors"
                  style={{ background: C.panel, color: C.sub, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {messages.map((m) =>
              m.role === 'user' ? (
                <Msg key={m.id} who="user">
                  {m.kind === 'text' ? m.text : ''}
                </Msg>
              ) : m.kind === 'pipeline' ? (
                <Msg key={m.id} who="assistant">
                  <PipelineCard m={m} />
                  <p className="leading-relaxed mb-3" style={{ color: C.text, fontFamily: serif, fontSize: 15 }}>
                    {m.text}
                  </p>
                  {m.artifact?.artifactId && INLINE_PREVIEW_KINDS.includes(m.artifact.kind) && (
                    <div className="mb-3">
                      <ArtifactPreview
                        artifactId={m.artifact.artifactId}
                        version={m.artifact.ver}
                        kind={m.artifact.kind}
                        height={280}
                      />
                    </div>
                  )}
                  {m.artifact && <ArtifactCard artifact={m.artifact} onOpen={() => onOpenArtifact(m.artifact as ArtifactRef)} />}
                </Msg>
              ) : (
                <Msg key={m.id} who="assistant">
                  {m.kind === 'text' && m.toolCalls ? <ToolChips chips={m.toolCalls} /> : null}
                  <p
                    className="leading-relaxed whitespace-pre-wrap"
                    style={{ color: C.text, fontFamily: serif, fontSize: 15 }}
                  >
                    {m.text}
                  </p>
                </Msg>
              ),
            )}
            {live && (
              <>
                <Msg who="user">{live.userText}</Msg>
                <Msg who="assistant">
                  {live.pipeline && (
                    <div
                      className="rounded-xl px-3.5 py-3 mb-3"
                      style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Zap size={13} style={{ color: C.accent }} />
                        <span className="text-xs font-medium" style={{ color: C.text, fontFamily: sans }}>
                          Document pipeline
                        </span>
                        {live.skillBadge ? (
                          <Badge color={C.accent} dim={C.accentDim}>
                            {live.skillBadge}
                          </Badge>
                        ) : null}
                      </div>
                      {live.steps.map((s) => (
                        <StepRow key={s.label} state={s.state} label={s.label} detail={s.detail} />
                      ))}
                    </div>
                  )}
                  {live.summary && (
                    <p className="leading-relaxed mb-3" style={{ color: C.text, fontFamily: serif, fontSize: 15 }}>
                      {live.summary}
                    </p>
                  )}
                  {live.artifact && (
                    <ArtifactCard artifact={live.artifact} onOpen={() => onOpenArtifact(live.artifact as ArtifactRef)} />
                  )}
                  {live.error ? (
                    <div
                      className="flex items-start gap-2 text-sm rounded-xl px-3.5 py-3"
                      style={{ background: C.amberDim, color: C.amber, fontFamily: sans }}
                    >
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{live.error}</span>
                    </div>
                  ) : !live.started && !live.pipeline ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: C.sub, fontFamily: sans }}>
                      <Loader2 size={14} className="animate-spin" style={{ color: C.accent }} />
                      Thinking…
                    </div>
                  ) : live.assistantText || live.toolChips.length ? (
                    <>
                      <ToolChips chips={live.toolChips} />
                      <p
                        className="leading-relaxed whitespace-pre-wrap"
                        style={{ color: C.text, fontFamily: serif, fontSize: 15 }}
                      >
                        {live.assistantText}
                      </p>
                    </>
                  ) : null}
                </Msg>
              </>
            )}
            <div ref={bottomRef} />
            {bedrockModal ? <BedrockModal onClose={() => setBedrockModal(false)} /> : null}
          </div>
        )}
      </div>

      <div className="px-6 pb-5">
        <div className="max-w-2xl mx-auto relative rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message Atlas…"
            className="w-full bg-transparent px-4 pt-3.5 text-sm outline-none resize-none"
            style={{ color: C.text, fontFamily: sans }}
          />
          <div className="flex items-center gap-1.5 px-3 pb-2.5">
            <button className="p-1.5 rounded-lg cursor-not-allowed" style={{ color: C.mute }} title="File uploads post-v1">
              <Paperclip size={16} />
            </button>
            <button className="p-1.5 rounded-lg" style={{ color: C.mute }}>
              <Sparkles size={16} />
            </button>
            <span className="ml-auto relative">
              <button
                onClick={() => setMenu(!menu)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
                style={{ color: C.sub, fontFamily: sans }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {selectedRow.name}
                <ChevronDown size={13} />
              </button>
              {menu && registry ? (
                <ModelMenu
                  registry={registry}
                  onSelect={(id) => {
                    void api.selectModel(id).then(() => {
                      void queryClient.invalidateQueries({ queryKey: ['models'] });
                    });
                  }}
                  onClose={() => setMenu(false)}
                  onConnectBedrock={() => setBedrockModal(true)}
                />
              ) : null}
            </span>
            <button className="p-1.5 rounded-lg" style={{ color: C.mute }}>
              <Mic size={16} />
            </button>
            <button
              onClick={send}
              disabled={busy}
              className="flex items-center justify-center rounded-lg"
              style={{ width: 30, height: 30, background: C.accent, opacity: busy ? 0.5 : 1 }}
            >
              {busy ? (
                <Loader2 size={15} color="#fff" className="animate-spin" />
              ) : (
                <ArrowUp size={16} color="#fff" strokeWidth={2.4} />
              )}
            </button>
          </div>
        </div>
        <p className="text-center text-xs mt-2.5" style={{ color: C.mute, fontFamily: sans }}>
          Atlas runs on this machine. Models: Gemma 4 E2B · E4B · 12B — Bedrock optional.
        </p>
      </div>
    </div>
  );
}
