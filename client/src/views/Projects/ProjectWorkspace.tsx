import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Brain, Lock, Plus, Pencil, FileText, Loader2, X, Trash2, ArrowUp, Upload } from 'lucide-react';
import { C, sans, serif, mono } from '../../theme/tokens';
import { api, type Project, type Conversation } from '../../lib/api';
import { MemoryModal } from '../../components/MemoryModal';

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** claude.ai-style project page: composer + chat list on the left, and a
 * right-hand panel with Memory / Instructions / Files (knowledge) inline. */
export function ProjectWorkspace({
  project,
  conversations,
  onBack,
  openConversation,
  newChatInProject,
  onDelete,
}: {
  project: Project;
  conversations: Conversation[];
  onBack: () => void;
  openConversation: (id: string) => void;
  newChatInProject: (projectId: string, message?: string) => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editingInstr, setEditingInstr] = useState(false);
  const [instrText, setInstrText] = useState(project.instructions ?? '');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const chats = conversations
    .filter((c) => c.projectId === project.id)
    .sort((a, b) => b.updated_at - a.updated_at);

  const { data: memory } = useQuery({
    queryKey: ['project-memory', project.id],
    queryFn: () => api.projectMemory(project.id),
  });
  const { data: files } = useQuery({
    queryKey: ['knowledge', project.id],
    queryFn: () => api.projectKnowledge(project.id),
    refetchInterval: (q) => (q.state.data?.some((f) => f.status === 'indexing') ? 2000 : false),
  });

  const memorySummary =
    memory?.profile?.text ??
    (memory && (memory.kv.length || memory.notes.length)
      ? [...memory.kv.map((k) => k.value), ...memory.notes.map((n) => n.content)].slice(0, 3).join(' · ')
      : null);

  const saveInstructions = (): void => {
    setEditingInstr(false);
    void api.updateProject(project.id, { instructions: instrText }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    );
  };

  const uploadFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(',')[1] ?? '';
      void api.uploadKnowledge(project.id, file.name, b64).then(() =>
        queryClient.invalidateQueries({ queryKey: ['knowledge', project.id] }),
      );
    };
    reader.readAsDataURL(file);
  };

  // drag-and-drop files anywhere on the workspace → project knowledge
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
    for (const f of Array.from(e.dataTransfer.files)) uploadFile(f);
  };

  const startChat = (): void => {
    const text = draft.trim();
    setDraft('');
    newChatInProject(project.id, text || undefined);
  };

  const Card = ({ children }: { children: React.ReactNode }): React.ReactElement => (
    <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      {children}
    </div>
  );

  return (
    <div
      className="flex-1 flex flex-col h-full min-w-0 overflow-y-auto relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(20,18,16,0.72)', backdropFilter: 'blur(2px)' }}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-2xl px-10 py-8"
            style={{ border: `2px dashed ${C.accent}`, background: C.panel }}
          >
            <Upload size={28} style={{ color: C.accent }} />
            <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>
              Drop files to add to {project.name}
            </span>
            <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
              PDFs, Office docs, text, and code — added to project knowledge
            </span>
          </div>
        </div>
      )}
      <div className="px-8 pt-6 pb-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm mb-4" style={{ color: C.mute, fontFamily: sans }}>
          <ArrowLeft size={14} /> All projects
        </button>
        <div className="flex items-center gap-3">
          <h1 style={{ fontFamily: serif, fontSize: 30, color: C.text }}>{project.name}</h1>
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md" style={{ color: C.green, background: C.greenDim, fontFamily: sans }}>
            <Lock size={11} /> Isolated
          </span>
          <button
            onClick={() => {
              if (window.confirm(`Delete project "${project.name}" and all its chats, memory, and knowledge? This cannot be undone.`)) onDelete();
            }}
            className="ml-auto p-1.5 rounded-lg"
            style={{ color: C.mute }}
            title="Delete project"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="px-8 pb-10 flex gap-6 items-start">
        {/* ── left: composer + chat list ── */}
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl p-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  startChat();
                }
              }}
              placeholder={`Start a new chat in ${project.name}…`}
              className="w-full bg-transparent px-2 pt-1.5 text-sm outline-none resize-none"
              style={{ color: C.text, fontFamily: sans }}
            />
            <div className="flex items-center justify-end px-1 pb-0.5">
              <button
                onClick={startChat}
                className="flex items-center justify-center rounded-lg"
                style={{ width: 30, height: 30, background: C.accent, color: '#fff' }}
                title="Start chat"
              >
                <ArrowUp size={15} />
              </button>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs font-medium uppercase tracking-wide mb-2 px-1" style={{ color: C.mute, fontFamily: sans }}>
              Chats in this project ({chats.length})
            </div>
            {chats.length === 0 ? (
              <div className="text-sm px-1 py-4" style={{ color: C.mute, fontFamily: sans }}>
                No chats yet — start one above.
              </div>
            ) : (
              <div className="flex flex-col">
                {chats.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className="text-left py-3 px-1 transition-colors"
                    style={{ borderBottom: `1px solid ${C.borderSoft}`, fontFamily: sans }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div className="text-sm" style={{ color: C.text }}>{c.title || 'New chat'}</div>
                    <div className="text-xs mt-0.5" style={{ color: C.mute }}>Last message {timeAgo(c.updated_at)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── right: Memory / Instructions / Files ── */}
        <div className="w-[360px] shrink-0 flex flex-col gap-3">
          {/* Memory */}
          <Card>
            <div className="flex items-center mb-2">
              <span className="text-sm font-medium flex items-center gap-1.5" style={{ color: C.text, fontFamily: sans }}>
                <Brain size={14} style={{ color: C.accent }} /> Memory
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs px-1.5 py-0.5 rounded" style={{ color: C.mute, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}>
                <Lock size={10} /> Project
              </span>
              <button onClick={() => setMemoryOpen(true)} className="ml-1.5 p-0.5" style={{ color: C.mute }} title="View & edit memory">
                <Pencil size={12} />
              </button>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: memorySummary ? C.sub : C.mute, fontFamily: sans, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {memorySummary ?? 'Nothing remembered yet. As you chat in this project, Atlas records durable facts here.'}
            </p>
            {memory?.profile?.generated_at ? (
              <div className="text-[11px] mt-1.5" style={{ color: C.mute, fontFamily: sans }}>
                Last updated {timeAgo(memory.profile.generated_at)}
              </div>
            ) : null}
          </Card>

          {/* Instructions */}
          <Card>
            <div className="flex items-center mb-2">
              <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>Instructions</span>
              {!editingInstr && (
                <button
                  onClick={() => { setInstrText(project.instructions ?? ''); setEditingInstr(true); }}
                  className="ml-auto p-0.5" style={{ color: C.mute }} title="Edit instructions"
                >
                  {project.instructions ? <Pencil size={13} /> : <Plus size={15} />}
                </button>
              )}
            </div>
            {editingInstr ? (
              <div>
                <textarea
                  rows={4}
                  value={instrText}
                  onChange={(e) => setInstrText(e.target.value)}
                  autoFocus
                  placeholder="Add instructions to tailor Atlas's responses in this project…"
                  className="w-full rounded-lg px-2.5 py-2 text-xs outline-none resize-none"
                  style={{ background: C.bg, color: C.text, border: `1px solid ${C.border}`, fontFamily: sans }}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={saveInstructions} className="px-3 py-1 rounded-lg text-xs font-medium" style={{ background: C.accent, color: '#fff', fontFamily: sans }}>Save</button>
                  <button onClick={() => setEditingInstr(false)} className="px-3 py-1 rounded-lg text-xs" style={{ color: C.mute, fontFamily: sans }}>Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-xs leading-relaxed" style={{ color: project.instructions ? C.sub : C.mute, fontFamily: sans }}>
                {project.instructions || "Add instructions to tailor Atlas's responses."}
              </p>
            )}
          </Card>

          {/* Files (Knowledge) */}
          <Card>
            <div className="flex items-center mb-2">
              <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>Files</span>
              <button onClick={() => fileRef.current?.click()} className="ml-auto p-0.5" style={{ color: C.mute }} title="Add a document">
                <Plus size={15} />
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
              />
            </div>
            <p className="text-[11px] mb-2.5" style={{ color: C.mute, fontFamily: sans }}>
              Documents here inform every chat in this project — Atlas cites the relevant passages automatically.
            </p>
            {files && files.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {files.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}>
                    <FileText size={14} style={{ color: C.accent }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate" style={{ color: C.text, fontFamily: sans }}>{f.name}</div>
                      <div className="text-[11px]" style={{ color: C.mute, fontFamily: mono }}>
                        {f.status === 'indexing' ? 'indexing…' : f.status === 'error' ? 'failed' : `${f.chunks} passages · ${(f.size / 1024).toFixed(0)} KB`}
                      </div>
                    </div>
                    {f.status === 'indexing' ? (
                      <Loader2 size={12} className="animate-spin" style={{ color: C.mute }} />
                    ) : (
                      <button
                        onClick={() => void api.deleteKnowledge(project.id, f.id).then(() => queryClient.invalidateQueries({ queryKey: ['knowledge', project.id] }))}
                        className="p-0.5" style={{ color: C.mute }} title="Remove"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-lg py-2 text-xs"
                style={{ border: `1px dashed ${C.border}`, color: C.mute, fontFamily: sans }}
              >
                + Add a document
              </button>
            )}
          </Card>
        </div>
      </div>

      {memoryOpen ? <MemoryModal projectId={project.id} projectName={project.name} onClose={() => setMemoryOpen(false)} /> : null}
    </div>
  );
}
