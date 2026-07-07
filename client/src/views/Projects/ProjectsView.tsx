import { useState } from 'react';
import { Plus, Brain, BookOpen, FolderKanban, Lock, Globe } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, sans, serif } from '../../theme/tokens';
import { api, type Project } from '../../lib/api';
import { MemoryModal } from '../../components/MemoryModal';
import { KnowledgeModal } from '../../components/KnowledgeModal';
import { Badge } from '../../components/Badge';
import { NewProjectModal } from '../../components/NewProjectModal';

export function ProjectsView({
  projects,
  activeProject,
  setActiveProject,
}: {
  projects: Project[];
  activeProject: string;
  setActiveProject: (id: string) => void;
}) {
  const [memoryFor, setMemoryFor] = useState<{ id: string; name: string } | null>(null);
  const [knowledgeFor, setKnowledgeFor] = useState<{ id: string; name: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const queryClient = useQueryClient();

  const create = (name: string, instructions: string) => {
    void api.createProject(name, instructions).then((p) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setActiveProject(p.id);
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4 flex items-end gap-3">
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Projects</h1>
          <p className="text-sm mt-1" style={{ color: C.sub, fontFamily: sans }}>
            Isolated workspaces — conversations, knowledge, memory, templates, and plugins never cross
            projects unless you opt in.
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
              onClick={() => setActiveProject(p.id)}
              role="button"
              className="rounded-xl p-4 flex flex-col gap-2.5 cursor-pointer transition-colors"
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
                    setKnowledgeFor({ id: p.id, name: p.name });
                  }}
                  className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md"
                  style={{ color: C.accent, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
                  title="Documents that inform every chat in this project"
                >
                  <BookOpen size={11} /> Knowledge
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMemoryFor({ id: p.id, name: p.name });
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md"
                  style={{ color: C.accent, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
                  title="View and edit this project's memory"
                >
                  <Brain size={11} /> Memory
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
