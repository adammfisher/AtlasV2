import { useEffect, useRef } from 'react';
import { Loader2, ChevronDown, X } from 'lucide-react';
import { C, sans, mono } from '../theme/tokens';

/** Claude-style live authoring view: the document source streams in as the model writes it. */
export function LivePanel({
  text,
  label,
  onClose,
}: {
  text: string;
  label: string;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div
      data-testid="live-panel"
      className="flex flex-col h-full flex-shrink-0"
      style={{ width: 'min(52vw, 880px)', minWidth: 480, background: C.panel, borderLeft: `1px solid ${C.borderSoft}` }}
    >
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <Loader2 size={15} className="animate-spin" style={{ color: C.accent }} />
        <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>
          Writing {label}…
        </span>
        <span className="text-xs ml-auto" style={{ color: C.mute, fontFamily: mono }}>
          {text.length.toLocaleString()} chars
        </span>
        <button onClick={onClose} className="p-1 rounded-md" style={{ color: C.mute }}>
          <X size={15} />
        </button>
      </div>
      <pre
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 whitespace-pre-wrap"
        style={{ background: C.bg, color: C.sub, fontFamily: mono, fontSize: 12, lineHeight: 1.55, margin: 0 }}
      >
        {text || 'waiting for first tokens…'}
        <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom animate-pulse" style={{ background: C.accent }} />
      </pre>
      <div
        className="flex items-center justify-center gap-1.5 py-2 text-xs"
        style={{ borderTop: `1px solid ${C.borderSoft}`, color: C.mute, fontFamily: sans }}
      >
        <ChevronDown size={13} className="animate-bounce" style={{ color: C.accent }} />
        streaming from Claude — the preview opens here when it finishes
      </div>
    </div>
  );
}
