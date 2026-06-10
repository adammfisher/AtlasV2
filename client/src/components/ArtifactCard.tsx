import { Eye, Download, History, FileText } from 'lucide-react';
import { C, MONO, ICONS } from '../theme/tokens';
import type { ArtifactRef } from '../lib/api';

export function ArtifactCard({ artifact, onOpen }: { artifact: ArtifactRef; onOpen: () => void }) {
  const Icon = ICONS[artifact.kind] ?? FileText;
  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 rounded-xl px-3.5 py-3 mt-3 cursor-pointer transition-colors"
      style={{ background: C.raise, border: `1px solid ${C.border}` }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: C.accentDim }}
      >
        <Icon size={17} style={{ color: C.accent }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate" style={{ color: C.text, fontFamily: MONO }}>
          {artifact.name}
        </div>
        <div className="text-xs" style={{ color: C.faint }}>
          {artifact.meta}
        </div>
      </div>
      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.raise2, color: C.dim }}>
        v{artifact.ver}
      </span>
      <Eye size={15} style={{ color: C.dim }} />
      <Download size={15} style={{ color: C.dim }} />
      <History size={15} style={{ color: C.dim }} />
    </div>
  );
}
