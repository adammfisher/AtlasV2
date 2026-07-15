import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { marked } from 'marked';
import {
  ChevronRight,
  ChevronDown,
  Lock,
  Loader2,
  Paperclip,
  Plus,
  Globe,
  GitBranch,
  Check,
  ImageIcon,
  Sparkles,
  Mic,
  ArrowUp,
  Zap,
  FolderKanban,
  AlertCircle,
  Box,
  Brain,
  Cog,
  Cloud,
  Square,
  FileText,
  Download,
  Copy,
  RefreshCw,
  Pencil,
  BookOpen,
  ThumbsUp,
  ThumbsDown,
  FileDown,
  Share2,
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, sans, serif, mono } from '../../theme/tokens';
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

marked.setOptions({ gfm: true, breaks: true });

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** strip anything script-y from model-produced markdown HTML (defense in depth) */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

/** Assistant text rendered as markdown (headings, tables, lists, code, bold),
 * with knowledge citations [source: filename] kept as accent badges (FR-5.5). */
function RichText({ text }: { text: string }) {
  const html = useMemo(() => {
    const cites: string[] = [];
    const withTokens = text.replace(/\[source: ([^\]]+)\]/g, (_m, f: string) => {
      cites.push(f);
      return `%%CITE${cites.length - 1}%%`;
    });
    let out = marked.parse(withTokens, { async: false }) as string;
    out = out.replace(/%%CITE(\d+)%%/g, (_m, i: string) => {
      const f = cites[Number(i)] ?? '';
      return `<span class="chat-cite" title="From project knowledge: ${escapeHtml(f)}">${escapeHtml(f)}</span>`;
    });
    return sanitizeHtml(out);
  }, [text]);
  // per-code-block copy affordance (claude.ai parity): decorate each <pre>
  // after render — the HTML is a sanitized string, so buttons attach here
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const pre of Array.from(root.querySelectorAll('pre'))) {
      if (pre.querySelector('.code-copy')) continue;
      const btn = document.createElement('button');
      btn.className = 'code-copy';
      btn.title = 'Copy code';
      btn.textContent = 'copy';
      btn.onclick = () => {
        void navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? pre.textContent ?? '');
        btn.textContent = 'copied';
        setTimeout(() => (btn.textContent = 'copy'), 1200);
      };
      pre.style.position = 'relative';
      pre.appendChild(btn);
    }
  }, [html]);
  return <div ref={ref} className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Uploaded-file chip: hover reveals a download action that pulls the original
 * back from S3 (local fallback server-side). */
function AttachmentChip({ a }: { a: { id: string; name: string } }) {
  return (
    <span
      className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs"
      style={{ background: 'rgba(255,255,255,0.08)', fontFamily: sans }}
    >
      <FileText size={11} /> {a.name}
      <a
        href={`/api/uploads/${a.id}/download`}
        download={a.name}
        title={`Download ${a.name}`}
        aria-label={`Download ${a.name}`}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: C.accent, display: 'inline-flex' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Download size={11} />
      </a>
    </span>
  );
}

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
  userAttachments?: Array<{ id: string; name: string; kind: string }>;
  userText: string;
  assistantText: string;
  thinkingText?: string;
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
  userName,
  activeProjectName,
  onOpenArtifact,
  onOpenArtifactList,
  onGenStream,
  onArtifactReady,
  autoSend,
  onAutoSendConsumed,
  onOpenProject,
}: {
  convId: string | null;
  registry: ModelsRegistry | undefined;
  userName: string;
  activeProjectName: string;
  onOpenArtifact: (a: ArtifactRef) => void;
  onOpenArtifactList: () => void;
  onGenStream: (text: string | null, label: string) => void;
  onArtifactReady: (a: ArtifactRef) => void;
  autoSend?: { convId: string; text: string; attachments?: Array<{ id: string; name: string; kind: 'image' | 'document' }> } | null;
  onAutoSendConsumed?: () => void;
  onOpenProject?: (projectId: string) => void;
}) {
  const [input, setInput] = useState('');
  const [menu, setMenu] = useState(false);
  const [plusMenu, setPlusMenu] = useState(false);
  const [live, setLive] = useState<LiveExchange | null>(null);
  const [bedrockModal, setBedrockModal] = useState(false);
  const [thinking, setThinking] = useState(false); // extended thinking toggle
  const [editing, setEditing] = useState<string | null>(null); // message id being edited
  const { data: rememberState } = useQuery({
    queryKey: ['remember', convId],
    queryFn: () => api.conversationRemember(convId as string),
    enabled: convId !== null,
  });
  const remember = rememberState?.remember ?? true;
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const webSearch = settings?.webSearchEnabled !== '0'; // on by default
  const toggleWebSearch = () => {
    void api.patchSettings({ webSearchEnabled: webSearch ? '0' : '1' }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
    );
  };
  const [attachments, setAttachments] = useState<
    Array<{ id: string; name: string; kind: 'image' | 'document'; thumb?: string; uploading?: boolean; pasted?: string }>
  >([]);
  // P4 per-chat connector toggles (project-enabled connectors, off per chat)
  const [chatToolsOff, setChatToolsOff] = useState<string[]>([]);
  const { data: pluginDir } = useQuery({ queryKey: ['plugins'], queryFn: api.pluginsDirectory });
  const chatConnectors = pluginDir?.filter(
    (e) => (e.status === 'connected' || e.status === 'bundled' || e.status === 'installed') && e.enabledProjects.length > 0,
  );
  useEffect(() => {
    setChatToolsOff([]);
    if (!convId) return;
    void fetch(`/api/conversations/${convId}/tools`)
      .then((r) => r.json())
      .then((d: { disabled?: string[] }) => setChatToolsOff(d.disabled ?? []));
  }, [convId]);

  // X1 response style per conversation (presets; custom via API sample call)
  const [chatStyle, setChatStyle] = useState<string>('normal');
  useEffect(() => setChatStyle('normal'), [convId]);

  // X6 voice dictation via the Web Speech API — free, on-device/browser, and
  // hidden entirely on unsupported browsers (graceful degrade per spec)
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const SpeechRec =
    (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  const speechSupported = Boolean(SpeechRec);
  const toggleDictation = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new (SpeechRec as new () => {
      continuous: boolean;
      interimResults: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    })();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const first = last?.isFinal ? last[0] : undefined;
      if (first) setInput((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${first.transcript}`);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  // "Try fixing" from a failed artifact bundle sends a repair request
  useEffect(() => {
    const onFix = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) void send(detail);
    };
    window.addEventListener('atlas-fix-artifact', onFix);
    return () => window.removeEventListener('atlas-fix-artifact', onFix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  // a send attempted while uploads were in flight — fires when they finish
  const [queuedSend, setQueuedSend] = useState<string | null>(null);
  useEffect(() => {
    if (queuedSend && attachments.length > 0 && !attachments.some((a) => a.uploading)) {
      const text = queuedSend;
      setQueuedSend(null);
      void send(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, queuedSend]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // auto-grow the composer with content (claude.ai parity) — grows a little,
  // then scrolls past a cap so it never dominates the view
  const growTextarea = (): void => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  useEffect(growTextarea, [input]);

  // large paste → a "PASTED" chip (claude.ai parity) instead of flooding the box
  const addPastedText = (text: string): void => {
    const tempId = `pending-pasted-${Math.random()}`;
    setAttachments((a) => [...a, { id: tempId, name: 'Pasted text', kind: 'document', uploading: true, pasted: text }]);
    const b64 = btoa(unescape(encodeURIComponent(text)));
    void api
      .uploadAttachment('pasted.txt', b64, conv?.projectId)
      .then((meta) => setAttachments((a) => a.map((x) => (x.id === tempId ? { ...meta, pasted: text, uploading: false } : x))))
      .catch(() => setAttachments((a) => a.filter((x) => x.id !== tempId)));
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    // pasted images (screenshots) → attach as image files with a thumbnail
    const imgs = Array.from(e.clipboardData.items || [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
      .map((f, i) => new File([f], f.name || `pasted-image-${Date.now()}-${i}.png`, { type: f.type || 'image/png' }));
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
      return;
    }
    const text = e.clipboardData.getData('text');
    if (text && (text.length > 600 || text.split('\n').length > 12)) {
      e.preventDefault();
      addPastedText(text);
    }
  };

  const addFiles = (files: FileList | File[] | null): void => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const tempId = `pending-${file.name}-${Date.now()}`;
      const isImage = /\.(png|jpe?g|gif|webp)$/i.test(file.name);
      const thumb = isImage ? URL.createObjectURL(file) : undefined;
      setAttachments((a) => [...a, { id: tempId, name: file.name, kind: isImage ? 'image' : 'document', thumb, uploading: true }]);
      void api
        .uploadAttachmentFile(file, conv?.projectId) // size-aware: presigned S3 for large files
        .then((meta) => setAttachments((a) => a.map((x) => (x.id === tempId ? { ...meta, thumb, uploading: false } : x))))
        .catch(() => setAttachments((a) => a.filter((x) => x.id !== tempId)));
    }
  };
  const genRef = useRef<{ text: string | null; label: string }>({ text: null, label: '' });
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // drag-and-drop file attach (claude.ai parity) — a counter avoids flicker as
  // the pointer crosses child elements during a drag.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files');
  const onDragEnter = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent): void => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const { data: conv } = useQuery({
    queryKey: ['conversation', convId],
    queryFn: () => api.conversation(convId as string),
    enabled: convId !== null,
  });

  const messages: Message[] = conv?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, live?.assistantText]);

  // auto-send a message the project workspace composer started a chat with
  const autoSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (autoSend && convId === autoSend.convId && autoSentRef.current !== autoSend.convId && !busy) {
      autoSentRef.current = autoSend.convId;
      void send(autoSend.text, false, autoSend.attachments);
      onAutoSendConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, convId]);

  const busy = live !== null;

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const send = async (
    overrideText?: string,
    retry = false,
    attsOverride?: Array<{ id: string; name: string; kind: 'image' | 'document' }>,
  ) => {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    // uploads in flight: queue the send instead of silently dropping it — the
    // message fires the moment the last upload lands (claude.ai behavior)
    if (!attsOverride && attachments.some((a) => a.uploading)) {
      setQueuedSend(text);
      return;
    }
    setQueuedSend(null);
    // no conversation yet (fresh install, or all chats deleted) — create one so
    // the composer always works instead of silently dropping the message
    let target = convId;
    if (target === null) {
      try {
        const conv = await api.createConversation();
        target = conv.id;
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch {
        return;
      }
    }
    // edit-message: drop the old message and everything after, then resend
    if (editing && !retry) {
      try {
        await api.truncateConversation(target, editing, true);
        await queryClient.invalidateQueries({ queryKey: ['conversation', target] });
      } catch {
        /* fall through — worst case the edit appends */
      }
      setEditing(null);
    }
    const sendAtts = retry ? [] : (attsOverride ?? attachments.map(({ id, name, kind }) => ({ id, name, kind })));
    // clear the composer whenever this send consumed its attachments — the
    // queued-send path passes overrideText but still owns the composer state
    if (!attsOverride && !retry) {
      setInput('');
      setAttachments([]);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLive({ toolChips: [], userText: retry ? '' : text, userAttachments: sendAtts, assistantText: '', started: false, error: null, pipeline: false, steps: [] });
    void postSse(`/conversations/${target}/messages`, { text, attachments: sendAtts, retry, thinking }, {
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
        } else if (event === 'thinking') {
          const delta = typeof data.delta === 'string' ? data.delta : '';
          setLive((l) => (l ? { ...l, thinkingText: (l.thinkingText ?? '') + delta } : l));
        } else if (event === 'assistant_text') {
          setLive((l) => (l ? { ...l, summary: (data as { text?: string }).text ?? '' } : l));
        } else if (event === 'error') {
          const message = typeof data.message === 'string' ? data.message : 'Unknown error';
          setLive((l) => (l ? { ...l, error: message } : l));
        }
      },
      onClose: () => {
        onGenStream(null, genRef.current.label);
        void queryClient.invalidateQueries({ queryKey: ['conversation', target] }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          // Always clear the live exchange: the server persists an honest error
          // message, so retaining the error here duplicated it AND left `busy`
          // stuck true — permanently dead composer after one failure.
          setLive(null);
        });
      },
      onError: (message) => {
        setLive((l) => (l ? { ...l, error: message } : l));
      },
    }, controller.signal); // stop button aborts the SSE fetch → onClose cleans up
  };

  const rate = async (messageId: string, rating: 'up' | 'down' | null): Promise<void> => {
    if (convId === null) return;
    await api.messageFeedback(convId, messageId, rating);
    await queryClient.invalidateQueries({ queryKey: ['conversation', convId] });
  };

  // regenerate: drop responses after the last user message and re-run it
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user' && m.kind === 'text');
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant' && m.kind === 'text')?.id;
  const retryLast = (): void => {
    if (!lastUserMsg || convId === null || busy) return;
    void api
      .truncateConversation(convId, lastUserMsg.id, false)
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversation', convId] }))
      .then(() => send(lastUserMsg.text ?? '', true));
  };

  const selectedRow =
    registry?.bedrockModels.find((m) => m.id === registry.selected) ?? { name: 'Claude Haiku 4.5' };
  const empty = messages.length === 0 && live === null;
  const offline = registry ? !registry.bedrock.connected : false;
  const artifactCount = conversationArtifacts(messages).length + (live?.artifact?.artifactId && !messages.some((m) => m.kind === 'pipeline' && m.artifact?.artifactId === live.artifact?.artifactId) ? 1 : 0);

  return (
    <div
      className="flex-1 flex flex-col h-full min-w-0 relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(20,18,16,0.72)', backdropFilter: 'blur(2px)' }}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-2xl px-10 py-8"
            style={{ border: `2px dashed ${C.accent}`, background: C.panel }}
          >
            <Paperclip size={28} style={{ color: C.accent }} />
            <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>
              Drop files to attach
            </span>
            <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
              Images, PDFs, Office docs, and text/code files
            </span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <button
          onClick={() => {
            const pid = conv?.projectId;
            if (pid && onOpenProject) onOpenProject(pid);
          }}
          className="flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-md transition-opacity hover:opacity-80"
          style={{ color: C.purple, background: C.purpleDim, fontFamily: sans }}
          title={`Open the "${activeProjectName}" project — this chat's memory and knowledge are scoped to it.`}
        >
          <FolderKanban size={13} /> {activeProjectName || 'No project'}
        </button>
        <ChevronRight size={13} style={{ color: C.mute }} />
        <span className="text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>
          {conv?.title ?? 'New chat'}
        </span>
        <span className="ml-auto" />
        <button
          onClick={() => {
            if (convId === null) return;
            void api.setConversationRemember(convId, !remember).then(() => {
              void queryClient.invalidateQueries({ queryKey: ['remember', convId] });
            });
          }}
          title={remember ? 'Memory on — Atlas remembers this chat. Click to exclude it.' : 'Memory off for this chat'}
          className="relative p-1.5 rounded-lg"
          style={{ color: remember ? C.accent : C.mute, opacity: convId === null ? 0.4 : 1 }}
        >
          <Brain size={16} />
          {!remember && (
            <span className="absolute inset-0 flex items-center justify-center text-[16px]" style={{ color: C.mute }}>
              ⃠
            </span>
          )}
        </button>
        <button
          onClick={() => {
            if (convId) window.location.href = `/api/conversations/${convId}/export`;
          }}
          title="Export chat as Markdown"
          className="p-1.5 rounded-lg"
          style={{ color: C.mute, opacity: convId ? 1 : 0.4 }}
        >
          <FileDown size={16} />
        </button>
        <button
          onClick={() => {
            if (!convId) return;
            void api.shareConversation(convId).then(({ url }) => {
              void navigator.clipboard.writeText(url);
            });
          }}
          title="Share conversation (copies a 7-day read-only link)"
          className="p-1.5 rounded-lg"
          style={{ color: C.mute, opacity: convId ? 1 : 0.4 }}
        >
          <Share2 size={16} />
        </button>
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
        {registry?.bedrock.connected ? (
          <Badge color={C.blue} dim={C.blueDim} icon={Cloud}>
            {selectedRow.name} · Amazon Bedrock
          </Badge>
        ) : (
          <Badge color={C.amber} dim={C.amberDim} icon={Cloud}>
            Not connected
          </Badge>
        )}
      </div>

      {offline && (
        <div
          className="flex items-center gap-2 px-5 py-2 text-xs"
          style={{ background: C.amberDim, color: C.amber, borderBottom: `1px solid ${C.borderSoft}`, fontFamily: sans }}
        >
          <AlertCircle size={13} />
          No model connected — open the model menu below and connect Amazon Bedrock.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="mb-1" style={{ color: C.text, fontFamily: serif, fontSize: 26 }}>
              What are we building, {userName}?
            </div>
            <div className="text-sm mb-6" style={{ color: C.mute, fontFamily: sans }}>
              Documents, decks, models, diagrams, and prototypes — powered by Claude on Amazon Bedrock.
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
                  {m.kind === 'text' && m.attachments?.length ? (
                    <span className="flex flex-wrap gap-1.5 mb-1.5">
                      {m.attachments.map((a) => (
                        <AttachmentChip key={a.id} a={a} />
                      ))}
                    </span>
                  ) : null}
                  <span className="group/msg inline">
                    {m.kind === 'text' ? m.text : ''}
                    <button
                      title="Edit message (regenerates everything after it)"
                      className="ml-2 align-middle opacity-0 group-hover/msg:opacity-60 hover:!opacity-100 transition-opacity"
                      style={{ color: C.mute }}
                      onClick={() => {
                        setInput(m.text ?? '');
                        setEditing(m.id);
                      }}
                    >
                      <Pencil size={11} />
                    </button>
                  </span>
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
                  {m.kind === 'text' && m.thinking ? (
                    <details className="mb-2 rounded-lg px-3 py-2" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
                      <summary className="text-xs cursor-pointer" style={{ color: C.mute, fontFamily: sans }}>
                        Thinking
                      </summary>
                      <pre className="text-xs mt-1.5 whitespace-pre-wrap" style={{ color: C.sub, fontFamily: sans }}>
                        {m.thinking}
                      </pre>
                    </details>
                  ) : null}
                  <div style={{ color: C.text, fontFamily: serif, fontSize: 15 }}>
                    <RichText text={m.text ?? ''} />
                  </div>
                  <span className="flex items-center gap-2 mt-1.5">
                    <button
                      title="Copy"
                      className="opacity-40 hover:opacity-100 transition-opacity"
                      style={{ color: C.mute }}
                      onClick={() => void navigator.clipboard.writeText(m.text ?? '')}
                    >
                      <Copy size={12} />
                    </button>
                    {m.id === lastAssistantId && !busy ? (
                      <button
                        title="Regenerate response"
                        className="opacity-40 hover:opacity-100 transition-opacity"
                        style={{ color: C.mute }}
                        onClick={retryLast}
                      >
                        <RefreshCw size={12} />
                      </button>
                    ) : null}
                    <button
                      title="Good response"
                      className={m.feedback === 'up' ? '' : 'opacity-40 hover:opacity-100 transition-opacity'}
                      style={{ color: m.feedback === 'up' ? C.green : C.mute }}
                      onClick={() => void rate(m.id, m.feedback === 'up' ? null : 'up')}
                    >
                      <ThumbsUp size={12} />
                    </button>
                    <button
                      title="Bad response"
                      className={m.feedback === 'down' ? '' : 'opacity-40 hover:opacity-100 transition-opacity'}
                      style={{ color: m.feedback === 'down' ? C.amber : C.mute }}
                      onClick={() => void rate(m.id, m.feedback === 'down' ? null : 'down')}
                    >
                      <ThumbsDown size={12} />
                    </button>
                  </span>
                </Msg>
              ),
            )}
            {live && (
              <>
                <Msg who="user">
                  {live.userAttachments?.length ? (
                    <span className="flex flex-wrap gap-1.5 mb-1.5">
                      {live.userAttachments.map((a) => (
                        <AttachmentChip key={a.id} a={a} />
                      ))}
                    </span>
                  ) : null}
                  {live.userText}
                </Msg>
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
                  ) : live.assistantText || live.toolChips.length || live.thinkingText ? (
                    <>
                      {live.thinkingText ? (
                        <div
                          className="rounded-lg px-3 py-2 mb-2 text-xs whitespace-pre-wrap"
                          style={{
                            background: C.panel,
                            color: C.mute,
                            fontFamily: sans,
                            maxHeight: 150,
                            overflowY: 'auto',
                            border: `1px solid ${C.borderSoft}`,
                          }}
                        >
                          <span className="font-medium" style={{ color: C.sub }}>
                            Thinking
                          </span>
                          {'\n'}
                          {live.thinkingText}
                        </div>
                      ) : null}
                      <ToolChips chips={live.toolChips} />
                      <div style={{ color: C.text, fontFamily: serif, fontSize: 15 }}>
                        <RichText text={live.assistantText} />
                      </div>
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
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message Atlas…"
            className="w-full bg-transparent px-4 pt-3.5 text-sm outline-none resize-none"
            style={{ color: C.text, fontFamily: sans, minHeight: 52, maxHeight: 200, overflowY: 'auto' }}
          />
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-2 pb-0.5">
              {attachments.map((a) =>
                a.pasted ? (
                  <span
                    key={a.id}
                    className="relative rounded-lg px-2.5 py-2 text-xs w-44"
                    style={{ background: C.bg, border: `1px solid ${C.borderSoft}`, color: C.mute, fontFamily: mono }}
                  >
                    <span
                      className="block overflow-hidden"
                      style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', lineHeight: 1.35 }}
                    >
                      {a.pasted.slice(0, 220)}
                    </span>
                    <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: C.borderSoft, color: C.sub, fontFamily: sans }}>
                      PASTED
                    </span>
                    {a.uploading ? <Loader2 size={11} className="animate-spin absolute right-6 top-2" /> : null}
                    <button
                      onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                      className="absolute right-1.5 top-1.5 p-0.5 rounded"
                      style={{ color: C.mute }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ) : (
                  <span
                    key={a.id}
                    className="relative flex items-center gap-1.5 rounded-lg pl-1.5 pr-6 py-1 text-xs"
                    style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, color: C.sub, fontFamily: sans }}
                  >
                    {a.thumb ? (
                      <img src={a.thumb} alt="" className="rounded" style={{ width: 28, height: 28, objectFit: 'cover' }} />
                    ) : (
                      <FileText size={14} style={{ color: C.accent }} />
                    )}
                    <span className="max-w-[160px] truncate">{a.name}</span>
                    {a.uploading ? <Loader2 size={11} className="animate-spin" /> : null}
                    <button
                      onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded"
                      style={{ color: C.mute }}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ),
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5 px-3 pb-2.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.rtf,.odt,.epub,.csv,.tsv,.md,.txt,.json,.html,.xml,.yaml,.yml,.log,.ipynb,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.cs,.go,.rb,.rs,.php,.swift,.kt,.sql,.sh,.css"
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <span className="relative">
              <button
                onClick={() => setPlusMenu((v) => !v)}
                className="p-1.5 rounded-lg"
                style={{ color: plusMenu ? C.accent : C.mute, background: plusMenu ? C.accentDim : 'transparent' }}
                title="Add files, connectors, and tools"
              >
                <Plus size={17} />
              </button>
              {plusMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPlusMenu(false)} />
                  <div
                    className="absolute bottom-full mb-2 left-0 z-50 rounded-xl py-1.5 min-w-[240px]"
                    style={{ background: C.raised, border: `1px solid ${C.border}`, boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}
                  >
                    <button
                      onClick={() => { setPlusMenu(false); fileInputRef.current?.click(); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm"
                      style={{ color: C.text, fontFamily: sans }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <ImageIcon size={15} style={{ color: C.mute }} /> Add files or photos
                    </button>
                    <button
                      onClick={() => {
                        setPlusMenu(false);
                        window.dispatchEvent(new CustomEvent('atlas-error', { detail: 'GitLab connector — coming soon.' }));
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm"
                      style={{ color: C.text, fontFamily: sans }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <GitBranch size={15} style={{ color: C.mute }} /> Add from GitLab
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ background: C.borderSoft, color: C.mute }}>Soon</span>
                    </button>
                    <div className="my-1 mx-2" style={{ borderTop: `1px solid ${C.borderSoft}` }} />
                    <button
                      onClick={() => { toggleWebSearch(); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm"
                      style={{ color: C.text, fontFamily: sans }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      title="When on, Atlas searches the web whenever a question needs current information"
                    >
                      <Globe size={15} style={{ color: webSearch ? C.accent : C.mute }} /> Web search
                      {webSearch ? <Check size={15} style={{ color: C.accent, marginLeft: 'auto' }} /> : <span className="ml-auto text-xs" style={{ color: C.mute }}>Off</span>}
                    </button>
                    <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wider" style={{ color: C.mute, fontFamily: sans }}>
                      Connectors (this chat)
                    </div>
                    {(chatConnectors ?? []).map((cn) => {
                      const off = chatToolsOff.includes(cn.id);
                      return (
                        <button
                          key={cn.id}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm"
                          style={{ color: off ? C.mute : C.text, fontFamily: sans }}
                          onClick={() => {
                            if (!convId) return;
                            const next = off ? chatToolsOff.filter((x) => x !== cn.id) : [...chatToolsOff, cn.id];
                            setChatToolsOff(next);
                            void fetch(`/api/conversations/${convId}/tools`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ connectorId: cn.id, enabled: off }),
                            });
                          }}
                        >
                          {cn.name}
                          {off ? (
                            <span className="ml-auto text-xs" style={{ color: C.mute }}>Off</span>
                          ) : (
                            <Check size={13} style={{ color: C.accent, marginLeft: 'auto' }} />
                          )}
                        </button>
                      );
                    })}
                    <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wider" style={{ color: C.mute, fontFamily: sans }}>
                      Response style
                    </div>
                    {(['normal', 'concise', 'explanatory', 'formal'] as const).map((st) => (
                      <button
                        key={st}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm capitalize"
                        style={{ color: chatStyle === st ? C.accent : C.text, fontFamily: sans }}
                        onClick={() => {
                          if (!convId) return;
                          setChatStyle(st);
                          void fetch(`/api/conversations/${convId}/style`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ style: st }),
                          });
                        }}
                      >
                        {st}
                        {chatStyle === st ? <Check size={13} style={{ marginLeft: 'auto' }} /> : null}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </span>
            <button
              onClick={() => setThinking((t) => !t)}
              className="p-1.5 rounded-lg flex items-center gap-1"
              style={{ color: thinking ? C.accent : C.mute, background: thinking ? C.accentDim : 'transparent' }}
              title={thinking ? 'Extended thinking ON — Claude reasons before answering' : 'Extended thinking off'}
            >
              <Sparkles size={16} />
              {thinking ? (
                <span className="text-xs font-medium" style={{ fontFamily: sans }}>
                  Thinking
                </span>
              ) : null}
            </button>
            {editing ? (
              <span
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md"
                style={{ background: C.amberDim, color: C.amber, fontFamily: sans }}
              >
                Editing message — sending replaces it and everything after
                <button onClick={() => { setEditing(null); setInput(''); }} title="Cancel edit">
                  <X size={11} />
                </button>
              </span>
            ) : null}
            {queuedSend ? (
              <span
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md"
                style={{ background: C.amberDim, color: C.amber, fontFamily: sans }}
              >
                Uploading — your message sends when the file is ready
                <button onClick={() => setQueuedSend(null)} title="Cancel queued send">
                  <X size={11} />
                </button>
              </span>
            ) : null}
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
            {speechSupported ? (
              <button
                onClick={toggleDictation}
                title={listening ? 'Stop dictation' : 'Dictate (Web Speech)'}
                data-listening={listening ? 'true' : 'false'}
                className="p-1.5 rounded-lg"
                style={{ color: listening ? C.accent : C.mute }}
              >
                <Mic size={16} />
              </button>
            ) : null}
            <button
              onClick={busy ? stop : () => void send()}
              title={busy ? 'Stop generating' : 'Send'}
              className="flex items-center justify-center rounded-lg"
              style={{ width: 30, height: 30, background: busy ? C.raised : C.accent, border: busy ? `1px solid ${C.border}` : 'none' }}
            >
              {busy ? (
                <Square size={12} color={C.text} fill={C.text} />
              ) : (
                <ArrowUp size={16} color="#fff" strokeWidth={2.4} />
              )}
            </button>
          </div>
        </div>
        <p className="text-center text-xs mt-2.5" style={{ color: C.mute, fontFamily: sans }}>
          {registry?.bedrock.connected
            ? `Powered by Claude on Amazon Bedrock · ${selectedRow.name}.`
            : 'Connect Amazon Bedrock in the model menu to start.'}
        </p>
      </div>
    </div>
  );
}
