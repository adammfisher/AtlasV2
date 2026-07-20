import { FileText, X, Download, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, sans } from '../theme/tokens';
import { api } from '../lib/api';
import { KnowledgePreview } from './KnowledgePreview';

/** Preview for a project knowledge file — same modal-overlay pattern as
 * MemoryModal/KnowledgeModal. (A right-edge side panel was tried first, to
 * match ArtifactPanel's chrome, but at normal workspace widths it squeezed
 * the composer/chat column into unreadably narrow wrapped text — a modal
 * doesn't fight the two-column workspace layout for width.) */
export function KnowledgeFileModal({
  projectId,
  fileId,
  name,
  onClose,
}: {
  projectId: string;
  fileId: string;
  name: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const remove = (): void => {
    if (!window.confirm(`Remove "${name}"? This deletes its passages from memory too.`)) return;
    void api.deleteKnowledge(projectId, fileId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['knowledge', projectId] });
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6" style={{ background: C.scrim }} onClick={onClose}>
      <div
        className="rounded-2xl w-full flex flex-col"
        style={{ maxWidth: 880, maxHeight: '85%', background: C.bg, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
          <FileText size={17} style={{ color: C.accent }} />
          <span className="text-base font-medium truncate" style={{ color: C.text, fontFamily: sans }}>
            {name}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <a
              href={`/api/projects/${projectId}/knowledge/${fileId}/download`}
              download={name}
              title="Download original"
              className="p-1.5 rounded-lg"
              style={{ color: C.mute, display: 'inline-flex' }}
            >
              <Download size={15} />
            </a>
            <button onClick={remove} className="p-1.5 rounded-lg" style={{ color: C.mute }} title="Remove from project">
              <Trash2 size={15} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: C.mute }}>
              <X size={16} />
            </button>
          </span>
        </div>
        <div className="px-5 pb-5 overflow-y-auto flex-1">
          <KnowledgePreview projectId={projectId} fileId={fileId} name={name} height={520} />
        </div>
      </div>
    </div>
  );
}
