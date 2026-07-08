import { useState } from 'react';
import { Plus, Brain, BookOpen, FolderKanban, Lock, Globe, Trash2, ArrowLeft, MessageSquarePlus, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, sans, serif } from '../../theme/tokens';
import { api, type Project, type Conversation } from '../../lib/api';
import { MemoryModal } from '../../components/MemoryModal';
import { KnowledgeModal } from '../../components/KnowledgeModal';
import { Badge } from '../../components/Badge';
import { NewProjectModal } from '../../components/NewProjectModal';

export function ProjectsView({
  projects,
  conversations,
  activeProject,
  setActiveProject,
  openConversation,
  newChatInProject,
}: {
  projects: Project[];
  conversations: Conversation[];
  activeProject: string;
  setActiveProject: (id: string) => void;
  openConversation: (id: string) => void;
  newChatInProject: (projectId: string) => void;
}) {
  const [memoryFor, setMemoryFor] = useState<{ id: string; name: string } | null>(null);
  const [knowledgeFor, setKnowledgeFor] = useState<{ id: string; name: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const create = (name: string, instructions: string) => {
    void api.createProject(name, instructions).then((p) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setActiveProject(p.id);
      setOpenId(p.id); // drop straight into the new project's workspace
    });
  };

  const openProject = (id: string) => {
    setActiveProject(id);
    setOpenId(id);
  };

  // ── project workspace (claude.ai-style): enter a project to see its chats,
  // instructions, knowledge and memory, and start chats scoped to it ──
  const opened = openId ? projects.find((p) => p.id === openId) : null;
  if (opened) {
    const chats = conversations
      .filter((c) => c.projectId === opened.id)
      .sort((a, b) => b.updated_at - a.updated_at);
    return (
      <div className="flex-1 flex flex-col h-full min-w-0">
        <div className="px-7 pt-6 pb-4">
          <button
            onClick={() => setOpenId(null)}
            className="flex items-center gap-1.5 text-sm mb-4"
            style={{ color: C.mute, fontFamily: sans }}
          >
            <ArrowLeft size={14} /> All projects
          </button>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center rounded-xl" style={{ width: 44, height: 44, background: C.purpleDim }}>
              <FolderKanban size={22} style={{ color: C.purple }} />
            </span>
            <div className="flex-1 min-w-0">
              <h1 style={{ fontFamily: serif, fontSize: 24, color: C.text }}>{opened.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge color={C.green} dim={C.greenDim} icon={Lock}>
                  Isolated workspace
                </Badge>
                <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
                  Chats, memory & knowledge here stay scoped to this project.
                </span>
              </div>
            </div>
          </div>

          {/* instructions */}
          <div className="mt-4 rounded-xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium uppercase tracking-wide" style={{ color: C.mute, fontFamily: sans }}>
                Project instructions
              </span>
              <button
                onClick={() => {
                  const next = window.prompt('Project instructions (applied to every chat in this project):', opened.instructions ?? '');
                  if (next !== null) {
                    void api.updateProject(opened.id, { instructions: next }).then(() =>
                      queryClient.invalidateQueries({ queryKey: ['projects'] }),
                    );
                  }
                }}
                className="p-0.5 rounded" style={{ color: C.mute }} title="Edit instructions"
              >
                <Pencil size={12} />
              </button>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: opened.instructions ? C.sub : C.mute, fontFamily: sans }}>
              {opened.instructions || 'No instructions yet — click the pencil to guide every chat in this project.'}
            </p>
          </div>

          {/* actions */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => newChatInProject(opened.id)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium"
              style={{ background: C.accent, color: '#fff', fontFamily: sans }}
            >
              <MessageSquarePlus size={15} /> New chat in this project
            </button>
            <button
              onClick={() => setKnowledgeFor({ id: opened.id, name: opened.name })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm"
              style={{ color: C.accent, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
            >
              <BookOpen size={14} /> Knowledge
            </button>
            <button
              onClick={() => setMemoryFor({ id: opened.id, name: opened.name })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm"
              style={{ color: C.accent, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
              title="Everything Atlas remembers about this project"
            >
              <Brain size={14} /> Project memory
            </button>
          </div>
        </div>

        {/* project's chats */}
        <div className="px-7 pb-8 overflow-y-auto flex-1">
          <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: C.mute, fontFamily: sans }}>
            Chats in this project ({chats.length})
          </div>
          {chats.length === 0 ? (
            <div className="text-sm rounded-xl p-6 text-center" style={{ color: C.mute, background: C.panel, border: `1px dashed ${C.border}`, fontFamily: sans }}>
              No chats yet. Start one with “New chat in this project”.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {chats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className="text-left rounded-lg px-3.5 py-2.5 text-sm transition-colors"
                  style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text, fontFamily: sans }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = C.panel)}
                >
                  {c.title || 'New chat'}
                </button>
              ))}
            </div>
          )}
        </div>
        {memoryFor ? <MemoryModal projectId={memoryFor.id} projectName={memoryFor.name} onClose={() => setMemoryFor(null)} /> : null}
        {knowledgeFor ? <KnowledgeModal projectId={knowledgeFor.id} projectName={knowledgeFor.name} onClose={() => setKnowledgeFor(null)} /> : null}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4 flex items-end gap-3">
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Projects</h1>
          <p className="text-sm mt-1" style={{ color: C.sub, fontFamily: sans }}>
            Isolated workspaces — conversations, knowledge, memory, templates, and plugins never cross
            projects unless you opt in. Open a project to work inside it.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="ml-auto flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium"
          style={{ background: C.accent, color: '#fff', fontFamily: sans }}
        >
          <Plus size={14} /> New project
        </button>
      </div>
      <div className="px-7 pb-8 overflow-y-auto grid grid-cols-2 gap-3">
        {projects.map((p) => {
          const active = p.id === activeProject;
          return (
            <div
              key={p.id}
              onClick={() => openProject(p.id)}
              role="button"
              className="group/proj rounded-xl p-4 flex flex-col gap-2.5 cursor-pointer transition-colors"
              style={{ background: C.panel, border: `1px solid ${active ? C.accent : C.border}` }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = C.panel)}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex items-center justify-center rounded-lg"
                  style={{ width: 34, height: 34, background: C.purpleDim }}
                >
                  <FolderKanban size={17} style={{ color: C.purple }} />
                </span>
                <span className="text-sm font-medium flex-1" style={{ color: C.text, fontFamily: sans }}>
                  {p.name}
                </span>
                {active && (
                  <Badge color={C.accent} dim={C.accentDim}>
                    Active
                  </Badge>
                )}
                {p.shared ? (
                  <Badge color={C.amber} dim={C.amberDim} icon={Globe}>
                    Shared library
                  </Badge>
                ) : (
                  <Badge color={C.green} dim={C.greenDim} icon={Lock}>
                    Isolated
                  </Badge>
                )}
              </div>
              <p className="text-xs leading-relaxed" style={{ color: C.sub, fontFamily: sans }}>
                {p.instructions || 'No instructions yet.'}
              </p>
              <div
                className="flex items-center gap-3 text-xs pt-1"
                style={{ color: C.mute, fontFamily: sans, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 10 }}
              >
                <span>{p.chats} chats</span>
                <span>{p.templates} templates</span>
                <span>{p.plugins} plugins</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openProject(p.id);
                  }}
                  className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md"
                  style={{ color: '#fff', background: C.accent, fontFamily: sans }}
                  title="Open this project's workspace"
                >
                  Open →
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete project "${p.name}" and all its chats, memory, and knowledge? This cannot be undone.`)) {
                      void api.deleteProject(p.id).then(() => {
                        void queryClient.invalidateQueries({ queryKey: ['projects'] });
                        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
                      });
                    }
                  }}
                  className="p-0.5 rounded-md opacity-0 group-hover/proj:opacity-60 hover:!opacity-100 transition-opacity"
                  style={{ color: C.mute }}
                  title="Delete project"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
        <div
          onClick={() => setShowNew(true)}
          role="button"
          className="rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer"
          style={{ border: `1px dashed ${C.border}`, minHeight: 140 }}
        >
          <Plus size={18} style={{ color: C.mute }} />
          <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
            Create a project to scope chats, memory, and plugins
          </span>
        </div>
      </div>
      {showNew && <NewProjectModal close={() => setShowNew(false)} create={create} />}
      {memoryFor ? (
        <MemoryModal projectId={memoryFor.id} projectName={memoryFor.name} onClose={() => setMemoryFor(null)} />
      ) : null}
      {knowledgeFor ? (
        <KnowledgeModal projectId={knowledgeFor.id} projectName={knowledgeFor.name} onClose={() => setKnowledgeFor(null)} />
      ) : null}
    </div>
  );
}
