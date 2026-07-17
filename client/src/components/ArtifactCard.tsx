import { Eye } from 'lucide-react';
import { C, sans, namedIcon } from '../theme/tokens';
import type { ArtifactRef } from '../lib/api';

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
};

export function ArtifactCard({ artifact, onOpen }: { artifact: ArtifactRef; onOpen: () => void }) {
  const Icon = namedIcon(KIND_ICONS[artifact.kind] ?? 'file-text');
  return (
    <button
      data-testid="artifact-card"
      data-kind={artifact.kind}
      data-ver={artifact.ver}
      onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors"
      style={{ background: C.panel, border: `1px solid ${C.border}` }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.panel)}
    >
      <span
        className="flex items-center justify-center rounded-lg flex-shrink-0"
        style={{ width: 38, height: 38, background: C.accentDim }}
      >
        <Icon size={18} style={{ color: C.accent }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>
          {artifact.name}
        </span>
        <span className="block text-xs" style={{ color: C.mute, fontFamily: sans }}>
          {artifact.meta}
        </span>
      </span>
      <Eye size={15} style={{ color: C.mute }} />
    </button>
  );
}
