import { useState } from 'react';
import { Plus, Folder, Lock, Layers } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, SERIF, MONO } from '../../theme/tokens';
import { api, type Project } from '../../lib/api';
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
  const [showNew, setShowNew] = useState(false);
  const queryClient = useQueryClient();

  const create = (name: string, instructions: string) => {
    void api.createProject(name, instructions).then((p) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setActiveProject(p.id);
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center">
          <h1 className="text-2xl" style={{ color: C.text, fontFamily: SERIF }}>
            Projects
          </h1>
          <button
            onClick={() => setShowNew(true)}
            className="ml-auto text-sm px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5 font-medium"
            style={{ background: C.accent, color: '#fff' }}
          >
            <Plus size={14} /> New project
          </button>
        </div>
        <p className="text-sm mt-1" style={{ color: C.dim }}>
          Each project scopes its own chats, files, memory, templates, and plugins. Nothing crosses
          between projects. Click a project to make it active.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
          {projects.map((p) => {
            const active = p.id === activeProject;
            return (
              <div
                key={p.id}
                onClick={() => setActiveProject(p.id)}
                role="button"
                className="rounded-xl p-4 cursor-pointer transition-colors"
                style={{
                  background: active ? C.raise : C.bg,
                  border: `1px solid ${active ? C.accent : C.borderSoft}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <Folder size={15} style={{ color: C.accent }} />
                  <span className="text-sm font-medium" style={{ color: C.text }}>
                    {p.name}
                  </span>
                  {active && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: C.accentDim, color: C.accent }}
                    >
                      Active
                    </span>
                  )}
                  <span
                    className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                    style={{ background: C.raise2, color: C.dim }}
                  >
                    <Lock size={10} /> Isolated
                  </span>
                </div>
                <p className="text-xs mt-2.5 leading-relaxed" style={{ color: C.dim }}>
                  {p.instructions || 'No instructions yet.'}
                </p>
                <div className="flex items-center gap-3 mt-3.5 text-xs" style={{ color: C.faint }}>
                  <span>{p.chats} chats</span>
                  <span>{p.artifacts} artifacts</span>
                  <span className="ml-auto" style={{ fontFamily: MONO }}>
                    {p.memory} memory
                  </span>
                </div>
              </div>
            );
          })}
          <div
            className="rounded-xl p-4 flex flex-col justify-center"
            style={{ border: `1px dashed ${C.border}` }}
          >
            <div className="flex items-center gap-2">
              <Layers size={15} style={{ color: C.dim }} />
              <span className="text-sm font-medium" style={{ color: C.dim }}>
                Shared library
              </span>
            </div>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: C.faint }}>
              Opt-in global partition. Publish artifacts, templates, or facts here to reference
              them from any project.
            </p>
          </div>
        </div>
      </div>
      {showNew && <NewProjectModal close={() => setShowNew(false)} create={create} />}
    </div>
  );
}
