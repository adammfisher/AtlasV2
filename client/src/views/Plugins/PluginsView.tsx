import { useState } from 'react';
import { Plus, Shield } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, SERIF } from '../../theme/tokens';
import { api, type PluginEntry, type Project } from '../../lib/api';
import { PluginCard } from './PluginCard';
import { PluginDetail } from './PluginDetail';
import { AddServerModal } from '../../components/AddServerModal';

export function PluginsView({
  plugins,
  projects,
  activeProject,
}: {
  plugins: PluginEntry[];
  projects: Project[];
  activeProject: string;
}) {
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const queryClient = useQueryClient();

  const counts: Record<string, number> = {
    all: plugins.length,
    connected: plugins.filter((p) => p.status === 'connected').length,
    available: plugins.filter((p) => p.status === 'available' || p.status === 'installing').length,
    planned: plugins.filter((p) => p.status === 'planned').length,
  };
  const shown = plugins.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'available') return p.status === 'available' || p.status === 'installing';
    return p.status === filter;
  });
  const sel = plugins.find((p) => p.id === selected);

  const setEnabled = (p: PluginEntry, projectId: string, enabled: boolean) => {
    if (!p.installId) return;
    // optimistic patch, server persists
    queryClient.setQueryData<PluginEntry[]>(['plugins'], (old) =>
      old?.map((entry) =>
        entry.id === p.id
          ? {
              ...entry,
              enabledProjects: enabled
                ? [...entry.enabledProjects, projectId]
                : entry.enabledProjects.filter((x) => x !== projectId),
            }
          : entry,
      ),
    );
    void api
      .togglePluginProject(p.installId, projectId, enabled)
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['plugins'] }));
  };

  const addCustom = async (name: string, transport: string, cmd: string) => {
    const res = await fetch('/api/plugins/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, transport, commandOrUrl: cmd }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `${res.status}`);
    }
    void queryClient.invalidateQueries({ queryKey: ['plugins'] });
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-start gap-3">
            <div>
              <h1 className="text-2xl" style={{ color: C.text, fontFamily: SERIF }}>
                Plugins
              </h1>
              <p className="text-sm mt-1" style={{ color: C.dim }}>
                MCP connectors, curated for this machine. Local servers launch from the bundled
                runtimes — no installs, no admin.
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="ml-auto flex-shrink-0 text-sm px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5 font-medium"
              style={{ background: C.accent, color: '#fff' }}
            >
              <Plus size={14} /> Add custom server
            </button>
          </div>

          <div className="flex items-center gap-1.5 mt-6 flex-wrap">
            {(
              [
                ['all', 'All'],
                ['connected', 'Connected'],
                ['available', 'Available'],
                ['planned', 'Planned'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className="text-xs px-3 py-1.5 rounded-full"
                style={{
                  background: filter === k ? C.raise2 : 'transparent',
                  color: filter === k ? C.text : C.dim,
                  border: `1px solid ${filter === k ? C.border : 'transparent'}`,
                }}
              >
                {label} <span style={{ color: C.faint }}>{counts[k]}</span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-xs" style={{ color: C.faint }}>
              <Shield size={12} /> SSRF allowlist active
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
            {shown.map((p) => (
              <PluginCard
                key={p.id}
                p={p}
                selected={selected === p.id}
                onSelect={() => setSelected(p.id === selected ? null : p.id)}
                onToggle={() =>
                  setEnabled(p, activeProject, !p.enabledProjects.includes(activeProject))
                }
                activeProject={activeProject}
              />
            ))}
          </div>
        </div>
      </div>
      {sel && (
        <PluginDetail
          p={sel}
          projects={projects}
          setEnabled={(projId, on) => setEnabled(sel, projId, on)}
          close={() => setSelected(null)}
        />
      )}
      {showAdd && <AddServerModal close={() => setShowAdd(false)} add={addCustom} />}
    </div>
  );
}
