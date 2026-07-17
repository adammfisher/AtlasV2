import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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
import { C, wash, sans, serif, mono } from '../../theme/tokens';
import {
  api,
  type ModelsRegistry,
  type Message,
  type ArtifactRef,
  type PipelineMessageData,
  type Citation,
} from '../../lib/api';
import { subscribeStreams, getLive, isBusy, startStream, stopStream, clearStream } from '../../lib/stream';
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
 * with knowledge citations [source: filename] kept as accent badges (FR-5.5) and
 * index-grounded citations (D) rendered as numbered superscript chips.
 *
 * Chips are injected as placeholder tokens at each citation's END offset BEFORE
 * markdown parsing, then swapped for HTML after — the same trick the [source:]
 * badges use, and the reason offsets are inserted back-to-front: an earlier
 * insertion would shift every later offset. */
function RichText({ text, citations, onOpenPassage }: { text: string; citations?: Citation[]; onOpenPassage?: (passageId: string) => void }) {
  const html = useMemo(() => {
    let source = text;
    // one chip per distinct cited span, numbered in reading order
    const chips = [...(citations ?? [])].filter((c) => c.end <= text.length && c.start >= 0).sort((a, b) => a.end - b.end);
    if (chips.length) {
      for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i]!;
        source = `${source.slice(0, c.end)}%%CHIP${i}%%${source.slice(c.end)}`;
      }
    }
    const cites: string[] = [];
    const withTokens = source.replace(/\[source: ([^\]]+)\]/g, (_m, f: string) => {
      cites.push(f);
      return `%%CITE${cites.length - 1}%%`;
    });
    let out = marked.parse(withTokens, { async: false }) as string;
    out = out.replace(/%%CITE(\d+)%%/g, (_m, i: string) => {
      const f = cites[Number(i)] ?? '';
      return `<span class="chat-cite" title="From project knowledge: ${escapeHtml(f)}">${escapeHtml(f)}</span>`;
    });
    out = out.replace(/%%CHIP(\d+)%%/g, (_m, i: string) => {
      const c = chips[Number(i)];
      if (!c) return '';
      const n = Number(i) + 1;
      const label = c.title ?? c.url ?? 'source';
      const tip = escapeHtml(`${label}${c.snippet ? ` — ${c.snippet.slice(0, 240)}` : ''}`);
      // a web source opens its URL; a knowledge passage opens the modal
      return c.url
        ? `<a class="chat-chip" href="${escapeHtml(c.url)}" target="_blank" rel="noreferrer noopener" title="${tip}">${n}</a>`
        : `<button class="chat-chip" type="button" data-passage="${escapeHtml(c.passageId ?? '')}" title="${tip}">${n}</button>`;
    });
    return sanitizeHtml(out);
  }, [text, citations]);
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
    // knowledge chips carry a passage id rather than a URL — open the modal.
    // The HTML is a sanitized string (inline handlers are stripped), so the
    // click has to be attached here.
    for (const chip of Array.from(root.querySelectorAll<HTMLButtonElement>('.chat-chip[data-passage]'))) {
      const passageId = chip.dataset.passage;
      if (!passageId || chip.dataset.wired) continue;
      chip.dataset.wired = '1';
      chip.onclick = () => onOpenPassage?.(passageId);
    }
  }, [html, onOpenPassage]);
  return <div ref={ref} className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The passage behind a knowledge citation chip (D.4).
 *
 * A web chip is a link and needs no UI. A knowledge chip has nowhere to point —
 * the passage lives in the project index — so clicking one shows the exact
 * sentences the claim was drawn from. (components/KnowledgeModal.tsx is
 * file-centric, has no passage addressing, and is currently imported nowhere, so
 * it is deliberately not reused here.) */
function PassageModal({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl p-4"
        style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-xs" style={{ color: C.mute, fontFamily: sans }}>
            <BookOpen size={13} />
            {citation.title ?? 'Project knowledge'}
          </span>
          <button onClick={onClose} style={{ color: C.mute }} title="Close">
            <X size={14} />
          </button>
        </div>
        <p className="text-sm whitespace-pre-wrap" style={{ color: C.text, fontFamily: serif }}>
          {citation.snippet || 'This passage is no longer available.'}
        </p>
      </div>
    </div>
  );
}

/** Uploaded-file chip: hover reveals a download action that pulls the original
 * back from S3 (local fallback server-side). */
function AttachmentChip({ a }: { a: { id: string; name: string } }) {
  return (
    <span
      className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs"
      style={{ background: C.hoverWash, fontFamily: sans }}
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

// setup rows the user doesn't need to see (internal plumbing)
const isSetupStep = (l: string): boolean => /^(Router|Skill loaded|Template|Escalated)/.test(l);
// granular validator checks — collapsed into a single "Validated" line
const isCheckStep = (l: string): boolean =>
  /audit|sanity|round.?trip|grep|thumbnail|recalc|formula|parse check|render check|well-?formed|viewbox|page.?count|external (request|call)|compile|#ref|schema \(/i.test(
    l,
  ) && !/^build_/i.test(l);

function PipelineCard({ m }: { m: PipelineMessageData }) {
  const [expanded, setExpanded] = useState(false);
  const steps = m.steps ?? [];

  if (m.edit) {
    const shown = steps.filter((s) => !isCheckStep(s.label));
    return (
      <div className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
        {shown.map((s) => (
          <StepRow key={s.label} state={s.state} label={s.label} detail={s.detail} />
        ))}
      </div>
    );
  }

  // primary phases shown individually; checks collapsed into one summary row
  const primary = steps.filter((s) => !isSetupStep(s.label) && !isCheckStep(s.label));
  const checks = steps.filter((s) => isCheckStep(s.label));
  const anyCheckWarn = checks.some((s) => s.state === 'warn');

  return (
    <div className="rounded-xl px-3.5 py-3 mb-3" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
      <button className="w-full flex items-center gap-2 mb-1.5" onClick={() => setExpanded((v) => !v)}>
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
      </button>
      {(expanded ? steps.filter((s) => !isCheckStep(s.label) || expanded) : primary).map((s) => (
        <StepRow key={s.label} state={s.state} label={s.label} detail={s.detail} />
      ))}
      {checks.length > 0 && !expanded ? (
        <StepRow
          state={anyCheckWarn ? 'warn' : 'ok'}
          label="Validated"
          detail={`${checks.length} checks${anyCheckWarn ? ' · some skipped' : ''}`}
        />
      ) : null}
      {steps.length > primary.length + Math.min(checks.length, 1) ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] mt-0.5"
          style={{ color: C.mute, fontFamily: sans }}
        >
          {expanded ? 'Hide detail' : 'Show detail'}
        </button>
      ) : null}
    </div>
  );
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
  onConvCreated,
}: {
  convId: string | null;
  registry: ModelsRegistry | undefined;
  userName?: string;
  activeProjectName: string;
  onOpenArtifact: (a: ArtifactRef) => void;
  onOpenArtifactList: () => void;
  onGenStream: (text: string | null, label: string) => void;
  onArtifactReady: (a: ArtifactRef) => void;
  autoSend?: { convId: string; text: string; attachments?: Array<{ id: string; name: string; kind: 'image' | 'document' }> } | null;
  onAutoSendConsumed?: () => void;
  onOpenProject?: (projectId: string) => void;
  /** a send from the empty state created this conversation — promote it to the
   * active conversation so the view follows the stream (FX-3). */
  onConvCreated?: (convId: string) => void;
}) {
  const [input, setInput] = useState('');
  const [menu, setMenu] = useState(false);
  const [plusMenu, setPlusMenu] = useState(false);
  // stream state lives OUTSIDE the component (lib/stream.ts): it survives
  // unmounts/nav and is keyed by conversation (FX-2)
  const live = useSyncExternalStore(subscribeStreams, () => getLive(convId));
  const busy = isBusy(convId);
  /** the knowledge passage behind a clicked citation chip (D.4) */
  const [passage, setPassage] = useState<Citation | null>(null);
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
  // W4: the composer toggle is PER-CHAT (claude.ai scope); global stays the default
  const [webOverride, setWebOverride] = useState<boolean | null>(null);
  useEffect(() => setWebOverride(null), [convId]);
  const webSearch = webOverride ?? (settings?.webSearchEnabled !== '0');
  const toggleWebSearch = () => {
    const next = !webSearch;
    setWebOverride(next);
    if (convId) {
      void fetch(`/api/conversations/${convId}/websearch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    }
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

  // bottom-stickiness: follow the stream only while the user is already near
  // the bottom, with instant (not smooth) scrolling during streaming — a
  // smooth-scroll per delta batch kept the main thread animating continuously
  // and fought the user's own scrollback (FX-5)
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: busy ? 'auto' : 'smooth' });
  }, [messages.length, live?.assistantText, busy]);

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

  const stop = () => {
    if (convId) stopStream(convId);
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
    // the stream store owns the SSE lifecycle from here: completion is keyed
    // on the `done` event, close-without-done surfaces as connection loss in
    // place, and the exchange survives unmount/nav (FX-2)
    startStream(target, { text, attachments: sendAtts, retry, thinking }, { onGenStream, onArtifactReady });
    // a send from the empty composer created this conversation — make it the
    // active one so the URL and view follow the stream (FX-3)
    if (target !== convId) onConvCreated?.(target);
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

  // bedrockModels is already limited to this account. Never name a model that
  // isn't in it: the old literal fallback claimed Haiku to accounts whose
  // allowlist omits it, while the server actually inferred with something else.
  const selectedRow =
    registry?.bedrockModels.find((m) => m.id === registry.selected) ??
    registry?.bedrockModels.find((m) => m.available !== false) ??
    registry?.bedrockModels[0] ?? { name: 'Model' };
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
          style={{ background: C.scrim, backdropFilter: 'blur(2px)' }}
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
          data-testid="artifact-list-btn"
          title="Artifacts in this chat"
          className="relative flex items-center justify-center p-1.5 rounded-lg transition-colors"
          style={{ color: artifactCount > 0 ? C.text : C.mute }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.hoverWash)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Box size={16} />
          {artifactCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-[10px] font-semibold"
              style={{ minWidth: 14, height: 14, padding: '0 3px', background: C.accent, color: C.accentContrast, fontFamily: sans }}
            >
              {artifactCount}
            </span>
          )}
        </button>
        {registry?.bedrock.connected ? null : (
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

      <div data-testid="chat-thread" ref={threadRef} className="flex-1 overflow-y-auto px-6 py-6">
        {empty ? (
          <div data-testid="chat-empty-state" className="h-full flex flex-col items-center justify-center">
            <div className="mb-1" style={{ color: C.text, fontFamily: serif, fontSize: 26 }}>
              {userName ? `What are we building, ${userName}?` : 'What are we building?'}
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
                    <RichText text={m.text ?? ''} citations={m.citations} onOpenPassage={(id) => setPassage(m.citations?.find((c) => c.passageId === id) ?? null)} />
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
              <div data-testid="live-exchange">
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
                      data-testid="stream-error"
                      className="flex items-start gap-2 text-sm rounded-xl px-3.5 py-3"
                      style={{ background: C.amberDim, color: C.amber, fontFamily: sans }}
                    >
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <span className="flex-1">{live.error}</span>
                      <button
                        data-testid="stream-retry"
                        onClick={() => {
                          const text = live.userText;
                          if (convId) clearStream(convId);
                          void send(text, true);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium flex-shrink-0"
                        style={{ background: wash(C.amber, 20), color: C.amber, border: `1px solid ${wash(C.amber, 40)}` }}
                        title="Retry this message"
                      >
                        <RefreshCw size={11} /> Retry
                      </button>
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
                        <RichText text={live.assistantText} citations={live.citations} onOpenPassage={(id) => setPassage(live.citations?.find((c) => c.passageId === id) ?? null)} />
                      </div>
                    </>
                  ) : null}
                </Msg>
              </div>
            )}
            <div ref={bottomRef} />
            {bedrockModal ? <BedrockModal onClose={() => setBedrockModal(false)} /> : null}
          </div>
        )}
      </div>

      <div className="px-6 pb-5">
        <div className="max-w-2xl mx-auto relative rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <textarea
            data-testid="composer"
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
                    style={{ background: C.raised, border: `1px solid ${C.border}`, boxShadow: C.shadowMenu }}
                  >
                    <button
                      onClick={() => { setPlusMenu(false); fileInputRef.current?.click(); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm"
                      style={{ color: C.text, fontFamily: sans }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.hoverWash)}
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
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.hoverWash)}
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
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.hoverWash)}
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
                onMouseEnter={(e) => (e.currentTarget.style.background = C.hoverWash)}
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
              data-testid="send-btn"
              data-busy={busy ? 'true' : 'false'}
              onClick={busy ? stop : () => void send()}
              title={busy ? 'Stop generating' : 'Send'}
              className="flex items-center justify-center rounded-lg"
              style={{ width: 30, height: 30, background: busy ? C.raised : C.accent, border: busy ? `1px solid ${C.border}` : 'none' }}
            >
              {busy ? (
                <Square size={12} fill="currentColor" style={{ color: C.text }} />
              ) : (
                <ArrowUp size={16} style={{ color: C.accentContrast }} strokeWidth={2.4} />
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
      {passage ? <PassageModal citation={passage} onClose={() => setPassage(null)} /> : null}
    </div>
  );
}
