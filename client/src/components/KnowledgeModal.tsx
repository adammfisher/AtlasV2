import { useRef } from 'react';
import { X, BookOpen, Trash2, Upload, Loader2, AlertCircle, Download } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, sans } from '../theme/tokens';
import { api } from '../lib/api';

/** Project knowledge (claude.ai parity): documents that persist on the project
 * and inform every chat in it. Uploads index into the project's semantic
 * memory; deleting a file removes its chunks. */
export function KnowledgeModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: files } = useQuery({
    queryKey: ['knowledge', projectId],
    queryFn: () => api.projectKnowledge(projectId),
    refetchInterval: (q) => (q.state.data?.some((f) => f.status === 'indexing') ? 2000 : false),
  });
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: ['knowledge', projectId] });

  const upload = (file: File): void => {
    void api.uploadKnowledgeFile(projectId, file).then(refresh); // size-aware: presigned S3 for large files
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="rounded-2xl w-full flex flex-col"
        style={{ maxWidth: 620, maxHeight: '80%', background: C.bg, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
          <BookOpen size={17} style={{ color: C.accent }} />
          <span className="text-base font-medium" style={{ color: C.text, fontFamily: sans }}>
            Knowledge — {projectName}
          </span>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg" style={{ color: C.mute }}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto flex-1">
          <p className="text-xs mt-3 mb-3" style={{ color: C.mute, fontFamily: sans }}>
            Documents added here persist on the project and inform every chat in it — Atlas recalls the
            relevant passages automatically. PDFs, office files, text, and code are supported.
          </p>

          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.rtf,.odt,.epub,.csv,.tsv,.md,.txt,.json,.html,.xml,.yaml,.yml,.log,.ipynb,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.cs,.go,.rb,.rs,.php,.swift,.kt,.sql,.sh,.css"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium mb-3"
            style={{ background: C.raised, color: C.text, border: `1px dashed ${C.border}`, fontFamily: sans }}
          >
            <Upload size={14} /> Add a document
          </button>

          {(files ?? []).map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-1.5"
              style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
            >
              <span className="text-sm flex-1 truncate" style={{ color: C.text, fontFamily: sans }} title={f.name}>
                {f.name}
              </span>
              <span className="text-xs flex items-center gap-1.5" style={{ color: C.mute, fontFamily: sans }}>
                {f.status === 'indexing' ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> indexing…
                  </>
                ) : f.status === 'error' ? (
                  <span title={f.error ?? ''} className="flex items-center gap-1" style={{ color: C.amber }}>
                    <AlertCircle size={12} /> failed
                  </span>
                ) : (
                  `${f.chunks} passages · ${(f.size / 1024).toFixed(0)} KB`
                )}
              </span>
              <a
                href={`/api/projects/${projectId}/knowledge/${f.id}/download`}
                download={f.name}
                title="Download original"
                style={{ color: C.mute, display: 'inline-flex' }}
              >
                <Download size={13} />
              </a>
              <button
                onClick={() => void api.deleteKnowledge(projectId, f.id).then(refresh)}
                title="Remove (deletes its passages from memory)"
                style={{ color: C.mute }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {files && files.length === 0 && (
            <p className="text-sm py-6 text-center" style={{ color: C.mute, fontFamily: sans }}>
              No knowledge files yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
