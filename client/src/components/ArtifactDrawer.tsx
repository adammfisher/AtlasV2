import { X, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { C, sans, mono, namedIcon } from '../theme/tokens';
import { api, type ArtifactRef, type Message } from '../lib/api';
import { Badge } from './Badge';

const KIND_ICONS: Record<string, string> = {
  pptx: 'presentation',
  docx: 'file-text',
  xlsx: 'file-spreadsheet',
  pdf: 'book-open',
  md: 'file-code',
  mermaid: 'git-branch',
  svg: 'layers',
  react: 'braces',
  site: 'braces',
  product: 'box',
};

/** Unique artifacts referenced by a conversation's pipeline messages (latest version wins). */
export function conversationArtifacts(messages: Message[]): ArtifactRef[] {
  const byId = new Map<string, ArtifactRef>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.kind === 'pipeline' && m.artifact?.artifactId) {
      byId.set(m.artifact.artifactId, m.artifact);
    }
  }
  return [...byId.values()];
}

function Row({ icon, name, sub, badge, onClick }: { icon: string; name: string; sub: string; badge?: string; onClick: () => void }) {
  const Icon = namedIcon(icon);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-1 text-left transition-colors"
      style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.panel)}
    >
      <span className="flex items-center justify-center rounded-lg flex-shrink-0" style={{ width: 32, height: 32, background: C.accentDim }}>
        <Icon size={15} style={{ color: C.accent }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm truncate" style={{ color: C.text, fontFamily: sans }}>
          {name}
        </span>
        <span className="block text-xs truncate" style={{ color: C.mute, fontFamily: mono }}>
          {sub}
        </span>
      </span>
      {badge && (
        <Badge color={C.purple} dim={C.purpleDim}>
          {badge}
        </Badge>
      )}
    </button>
  );
}

export function ArtifactDrawer({
  convId,
  onSelect,
  onClose,
}: {
  convId: string | null;
  onSelect: (artifactId: string) => void;
  onClose: () => void;
}) {
  const { data: conv } = useQuery({
    queryKey: ['conversation', convId],
    queryFn: () => api.conversation(convId as string),
    enabled: convId !== null,
  });
  const inConv = conversationArtifacts(conv?.messages ?? []);

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{ width: 380, background: '#21201e', borderLeft: `1px solid ${C.borderSoft}` }}
    >
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <FileText size={15} style={{ color: C.accent }} />
        <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>
          Artifacts
        </span>
        <span className="text-xs ml-1" style={{ color: C.mute, fontFamily: sans }}>
          {inConv.length} in this chat
        </span>
        <button onClick={onClose} className="ml-auto p-1 rounded-md" style={{ color: C.mute }}>
          <X size={15} />
        </button>
      </div>
      <div className="px-4 py-3 overflow-y-auto flex-1">
        {inConv.length === 0 ? (
          <div className="text-xs mb-3" style={{ color: C.mute, fontFamily: sans }}>
            Nothing generated in this chat yet. Everything across chats lives in the Artifacts gallery.
          </div>
        ) : (
          inConv.map((a) => (
            <Row
              key={a.artifactId}
              icon={KIND_ICONS[a.kind] ?? 'file-text'}
              name={a.name}
              sub={`v${a.ver} · ${a.meta}`}
              badge={a.kind === 'product' ? (a.state ?? 'product') : undefined}
              onClick={() => onSelect(a.artifactId as string)}
            />
          ))
        )}
      </div>
    </div>
  );
}
