import { useState } from 'react';
import { Plus, Search, Building2, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, sans, serif } from '../../theme/tokens';
import { api, type PluginEntry, type Project } from '../../lib/api';
import { PluginCard } from './PluginCard';
import { PluginModal } from './PluginModal';
import { CustomServerModal } from './CustomServerModal';

const FILTERS = ['All', 'Installed', 'stdio', 'Remote'] as const;
type Filter = (typeof FILTERS)[number];

export function PluginsView({
  plugins,
  projects,
  activeProject,
}: {
  plugins: PluginEntry[];
  projects: Project[];
  activeProject: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const queryClient = useQueryClient();

  const matches = (p: PluginEntry): boolean => {
    if (search && !`${p.name} ${p.vendor} ${p.description}`.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (filter === 'Installed') return p.status === 'installed' || p.status === 'bundled';
    if (filter === 'stdio') return p.transport === 'stdio';
    if (filter === 'Remote') return p.transport !== 'stdio';
    return true;
  };
  const shown = plugins.filter(matches);
  const featured = shown.filter((p) => p.featured);
  const rest = shown.filter((p) => !p.featured);
  const open = plugins.find((p) => p.id === openId);

  const install = (id: string) => {
    setNotice(null);
    queryClient.setQueryData<PluginEntry[]>(['plugins'], (old) =>
      old?.map((e) => (e.id === id ? { ...e, status: 'installing' } : e)),
    );
    void api
      .installPlugin(id, activeProject)
      .then((r) => {
        if (r.lastError) setNotice(r.lastError);
      })
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)))
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['plugins'] }));
  };

  const toggleProj = (p: PluginEntry, projectId: string, enabled: boolean) => {
    if (!p.installId) return;
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

  return (
    <div className="relative flex-1 flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4">
        <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Plugins</h1>
        <p className="text-sm mt-1" style={{ color: C.sub, fontFamily: sans }}>
          MCP connectors, curated for this workspace. Local servers launch from Axiom's bundled runtimes —
          nothing to install on the machine.
        </p>
      </div>
      <div className="px-7 flex items-center gap-2 pb-4">
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 flex-1 max-w-sm"
          style={{ background: C.panel, border: `1px solid ${C.border}` }}
        >
          <Search size={14} style={{ color: C.mute }} />
          <input
            placeholder="Search connectors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1"
            style={{ color: C.text, fontFamily: sans }}
          />
        </div>
        {FILTERS.map((f) => {
          const count = plugins.filter((x) =>
            f === 'All' ? true : f === 'Installed' ? x.installId !== null || x.status === 'bundled'
            : f === 'stdio' ? x.transport === 'stdio' : x.transport !== 'stdio',
          ).length;
          return (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{
              background: filter === f ? C.raised : 'transparent',
              color: filter === f ? C.text : C.mute,
              border: `1px solid ${filter === f ? C.border : 'transparent'}`,
              fontFamily: sans,
            }}
          >
            {f} · {count}
          </button>
          );
        })}
        <span
          className="px-2.5 py-1.5 rounded-lg text-xs"
          style={{ color: C.mute, border: `1px dashed ${C.borderSoft}`, fontFamily: sans }}
        >
          SSRF allowlisted
        </span>
        <button
          onClick={() => setShowCustom(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}`, fontFamily: sans }}
        >
          <Plus size={13} /> Add custom server
        </button>
      </div>

      {notice && (
        <div
          className="mx-7 mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: C.amberDim, color: C.amber, border: `1px solid ${C.amber}`, fontFamily: sans }}
        >
          <AlertCircle size={13} /> {notice}
        </div>
      )}

      <div className="px-7 pb-8 overflow-y-auto">
        {featured.length > 0 ? (
          <>
            <div className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: C.accent, fontFamily: sans }}>
              Knowledge layer
            </div>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {featured.map((p) => (
                <PluginCard key={p.id} p={p} activeProject={activeProject} onOpen={setOpenId} onInstall={install} />
              ))}
              <div className="rounded-xl p-4 flex flex-col justify-center gap-1.5" style={{ border: `1px dashed ${C.border}` }}>
                <span className="text-sm font-medium flex items-center gap-2" style={{ color: C.sub, fontFamily: sans }}>
                  <Building2 size={15} style={{ color: C.mute }} /> Knowledge Core ingests Confluence + Jira
                </span>
                <span className="text-xs leading-relaxed" style={{ color: C.mute, fontFamily: sans }}>
                  Runs as a peer service on this machine. Install registers it against the bundled runtime and
                  scopes its six org tools per project.
                </span>
              </div>
            </div>
          </>
        ) : null}
        <div className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: C.mute, fontFamily: sans }}>
          Directory
        </div>
        {shown.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: C.mute, fontFamily: sans }}>
            No connectors match "{search || filter}" — clear the search or switch filters.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {rest.map((p) => (
              <PluginCard key={p.id} p={p} activeProject={activeProject} onOpen={setOpenId} onInstall={install} />
            ))}
          </div>
        )}
      </div>

      {open ? (
        <PluginModal
          p={open}
          projects={projects}
          activeProject={activeProject}
          onClose={() => setOpenId(null)}
          toggleProj={(projId, enabled) => toggleProj(open, projId, enabled)}
        />
      ) : null}
      {showCustom ? (
        <CustomServerModal
          activeProject={activeProject}
          onClose={() => setShowCustom(false)}
          onResult={(msg) => {
            if (msg) setNotice(msg);
            void queryClient.invalidateQueries({ queryKey: ['plugins'] });
          }}
        />
      ) : null}
    </div>
  );
}
