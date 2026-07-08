import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Brain, Lock, Plus, Pencil, FileText, Loader2, X, Trash2, ArrowUp, Paperclip } from 'lucide-react';
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
  newChatInProject: (projectId: string, message?: string, attachments?: Array<{ id: string; name: string; kind: 'image' | 'document' }>) => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  // per-chat attachments for the message that STARTS the new chat (distinct
  // from project Files/knowledge) — dropped/picked on the composer only.
  const [atts, setAtts] = useState<Array<{ id: string; name: string; kind: 'image' | 'document'; thumb?: string; uploading?: boolean }>>([]);
  const [composerDrag, setComposerDrag] = useState(false);
  const attInputRef = useRef<HTMLInputElement>(null);
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

  // drop onto the Files card → project knowledge (distinct from the composer,
  // which attaches to a single chat)
  const [knowledgeDrag, setKnowledgeDrag] = useState(false);
  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files');

  // upload a file as a CHAT attachment (message-scoped, not project knowledge)
  const addAttachments = (files: FileList | File[]): void => {
    for (const file of Array.from(files)) {
      const tempId = `pending-${file.name}-${Math.random()}`;
      const isImage = /\.(png|jpe?g|gif|webp)$/i.test(file.name);
      const thumb = isImage ? URL.createObjectURL(file) : undefined;
      setAtts((a) => [...a, { id: tempId, name: file.name, kind: isImage ? 'image' : 'document', thumb, uploading: true }]);
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result).split(',')[1] ?? '';
        void api
          .uploadAttachment(file.name, b64)
          .then((meta) => setAtts((a) => a.map((x) => (x.id === tempId ? { ...meta, thumb, uploading: false } : x))))
          .catch(() => setAtts((a) => a.filter((x) => x.id !== tempId)));
      };
      reader.readAsDataURL(file);
    }
  };

  const startChat = (): void => {
    if (atts.some((a) => a.uploading)) return; // wait for uploads
    const text = draft.trim();
    if (!text && atts.length === 0) return;
    const sendAtts = atts.map(({ id, name, kind }) => ({ id, name, kind }));
    setDraft('');
    setAtts([]);
    newChatInProject(project.id, text || 'Take a look at the attached file(s).', sendAtts);
  };

  const Card = ({ children }: { children: React.ReactNode }): React.ReactElement => (
    <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      {children}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 overflow-y-auto relative">
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
          <div
            className="rounded-2xl p-3 relative"
            style={{ background: C.panel, border: `1px solid ${composerDrag ? C.accent : C.border}` }}
            onDragEnter={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.stopPropagation(); setComposerDrag(true); } }}
            onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
            onDragLeave={(e) => { e.stopPropagation(); setComposerDrag(false); }}
            onDrop={(e) => {
              if (!Array.from(e.dataTransfer.types).includes('Files')) return;
              e.preventDefault();
              e.stopPropagation(); // attach to THIS chat, not project knowledge
              setComposerDrag(false);
              addAttachments(e.dataTransfer.files);
            }}
          >
            {composerDrag && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl pointer-events-none" style={{ background: 'rgba(20,18,16,0.7)' }}>
                <span className="text-sm font-medium" style={{ color: C.accent, fontFamily: sans }}>Drop to attach to this chat</span>
              </div>
            )}
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
            {atts.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1 pt-1 pb-1.5">
                {atts.map((a) => (
                  <span key={a.id} className="relative flex items-center gap-1.5 rounded-lg pl-1.5 pr-6 py-1 text-xs" style={{ background: C.bg, border: `1px solid ${C.borderSoft}`, color: C.sub, fontFamily: sans }}>
                    {a.thumb ? <img src={a.thumb} alt="" className="rounded" style={{ width: 24, height: 24, objectFit: 'cover' }} /> : <FileText size={13} style={{ color: C.accent }} />}
                    <span className="max-w-[150px] truncate">{a.name}</span>
                    {a.uploading ? <Loader2 size={11} className="animate-spin" /> : null}
                    <button onClick={() => setAtts((l) => l.filter((x) => x.id !== a.id))} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5" style={{ color: C.mute }}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center px-1 pb-0.5">
              <button onClick={() => attInputRef.current?.click()} className="p-1.5 rounded-lg" style={{ color: C.mute }} title="Attach files to this chat">
                <Paperclip size={16} />
              </button>
              <input
                ref={attInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) addAttachments(e.target.files); e.target.value = ''; }}
              />
              <button
                onClick={startChat}
                className="ml-auto flex items-center justify-center rounded-lg"
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

          {/* Files (Knowledge) — drop target for project-wide documents */}
          <div
            className="rounded-2xl p-4"
            style={{ background: C.panel, border: `1px solid ${knowledgeDrag ? C.accent : C.border}` }}
            onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); setKnowledgeDrag(true); } }}
            onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
            onDragLeave={() => setKnowledgeDrag(false)}
            onDrop={(e) => {
              if (!hasFiles(e)) return;
              e.preventDefault();
              setKnowledgeDrag(false);
              for (const f of Array.from(e.dataTransfer.files)) uploadFile(f);
            }}
          >
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
              {knowledgeDrag ? 'Drop to add to project knowledge…' : 'Documents here inform every chat in this project — drag files here or use +. Atlas cites the relevant passages automatically.'}
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
          </div>
        </div>
      </div>

      {memoryOpen ? <MemoryModal projectId={project.id} projectName={project.name} onClose={() => setMemoryOpen(false)} /> : null}
    </div>
  );
}
